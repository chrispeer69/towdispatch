/**
 * Motor-club gateway HTTP surface. Public ingest endpoint accepts a
 * minimal Agero dispatch payload, creates the underlying job +
 * motor_club_dispatches row, and acks. Outbound status pushes are
 * recorded by AgeroStubProvider so the E2E suite can assert what the
 * gateway sent.
 *
 * In production the inbound endpoint is signed via Agero's HMAC; the
 * verification middleware is a TODO marked in the controller. Test
 * mode (NODE_ENV=test or AGERO_INBOUND_HMAC_DISABLED=1) skips the
 * check so E2E can drive it without a real signing key.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { dynamicPricingTiers, tenants, uuidv7 } from '@ustowdispatch/db';
import { dynamicPricingTenantSettingsSchema } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { AgeroStubProvider } from './agero-stub.provider.js';

interface InboundDispatchPayload {
  tenantId: string;
  externalId: string;
  service: string;
  customer: { name: string; phone?: string };
  pickup: { address: string; lat?: number; lng?: number };
  dropoff?: { address: string; lat?: number; lng?: number };
  vehicle?: { make?: string; model?: string; year?: number; plate?: string };
}

@Controller('motor-club/agero')
export class MotorClubController {
  constructor(
    private readonly stub: AgeroStubProvider,
    private readonly admin: TransactionRunner,
  ) {}

  /**
   * Inbound dispatch. Public to match the real ARES protocol where the
   * remote signs the request rather than presenting a bearer token. In
   * dev/test the HMAC check is skipped.
   */
  @Public()
  @Post('dispatch')
  async dispatch(
    @Body() payload: InboundDispatchPayload,
  ): Promise<{
    jobId: string;
    stormSurgeOfferAvailable?: boolean;
    stormSurge?: { tierName: string | null; multiplier: number | null };
  }> {
    if (!payload.tenantId || !payload.externalId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'tenantId and externalId required',
      });
    }
    this.stub.ingest({
      externalId: payload.externalId,
      receivedAt: new Date().toISOString(),
      status: 'offered',
      service: payload.service,
      customer: payload.customer,
      pickup: {
        lat: payload.pickup.lat ?? 0,
        lng: payload.pickup.lng ?? 0,
        address: payload.pickup.address,
      },
      ...(payload.dropoff
        ? {
            dropoff: {
              lat: payload.dropoff.lat ?? 0,
              lng: payload.dropoff.lng ?? 0,
              address: payload.dropoff.address,
            },
          }
        : {}),
      ...(payload.vehicle ? { vehicle: payload.vehicle } : {}),
    });

    // Create the job in the target tenant. Use the admin pool path
    // because the inbound caller is a third party, not a tenant user.
    const jobId = uuidv7();
    await this.admin.runAsAdmin({}, async (_db, client) => {
      // Allocate a job_number in the YYYYMMDD-NNNN format the
      // jobs_job_number_format check constraint enforces, using the
      // same job_number_sequences table jobs.service.ts uses.
      const now = new Date();
      const dayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
      const seqRes = await client.query<{ last_seq: string | number }>(
        `INSERT INTO job_number_sequences (tenant_id, day_key, last_seq, updated_at)
         VALUES ($1::uuid, $2, 1, now())
         ON CONFLICT (tenant_id, day_key)
         DO UPDATE SET last_seq = job_number_sequences.last_seq + 1, updated_at = now()
         RETURNING last_seq`,
        [payload.tenantId, dayKey],
      );
      const seq = Number(seqRes.rows[0]?.last_seq ?? 0);
      const jobNumber = `${dayKey}-${String(seq).padStart(4, '0')}`;

      await client.query(
        `INSERT INTO jobs (
            id, tenant_id, job_number, status, service_type,
            pickup_address, authorized_by, rate_quoted_cents, notes,
            created_at, updated_at,
            external_source, external_id
         ) VALUES (
            $1, $2, $3, 'new', $4,
            $5, 'motor_club', 0, 'agero:dispatch',
            now(), now(),
            'agero', $6
         ) ON CONFLICT DO NOTHING`,
        [
          jobId,
          payload.tenantId,
          jobNumber,
          payload.service,
          payload.pickup.address,
          payload.externalId,
        ],
      );
      // motor_club_dispatches row so the existing UI badge logic
      // surfaces this as an Agero job on the board.
      await client.query(
        `INSERT INTO motor_club_dispatches (
            id, tenant_id, job_id, network, network_external_id,
            imported, external_source, external_id, created_at, updated_at
         ) VALUES (
            $1, $2, $3, 'agero', $4, false, 'agero', $5, now(), now()
         ) ON CONFLICT DO NOTHING`,
        [uuidv7(), payload.tenantId, jobId, payload.externalId, `${payload.externalId}:agero`],
      );
    });

    // Storm Surge Offer Engine (Moat #1) — if the tenant has the flag
    // enabled AND any active Weather tier with multiplier >= 1.5x, surface
    // an offer the operator can extend to the customer (higher-priced
    // direct dispatch in lieu of the lower motor-club rate). The operator
    // accepts/declines via /motor-club/agero/storm-surge-offer/:jobId/*.
    let stormSurgeOfferAvailable = false;
    let stormSurgeMultiplier: number | null = null;
    let stormSurgeTierName: string | null = null;
    await this.admin.runAsAdmin({}, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, payload.tenantId),
      });
      const settings = parseDynPricingSettings(tenant?.settings);
      if (settings.motorClubStormSurgeEnabled) {
        const weatherTiers = await db.query.dynamicPricingTiers.findMany({
          where: and(
            eq(dynamicPricingTiers.tenantId, payload.tenantId),
            eq(dynamicPricingTiers.category, 'weather'),
            eq(dynamicPricingTiers.isActive, true),
            isNull(dynamicPricingTiers.deletedAt),
          ),
        });
        const max = weatherTiers.reduce<{ name: string; m: number } | null>((acc, t) => {
          const m = Number(t.multiplier);
          if (m >= 1.5 && (!acc || m > acc.m)) return { name: t.name, m };
          return acc;
        }, null);
        if (max) {
          stormSurgeOfferAvailable = true;
          stormSurgeMultiplier = max.m;
          stormSurgeTierName = max.name;
        }
      }
    });

    return {
      jobId,
      stormSurgeOfferAvailable,
      ...(stormSurgeOfferAvailable
        ? {
            stormSurge: {
              tierName: stormSurgeTierName,
              multiplier: stormSurgeMultiplier,
            },
          }
        : {}),
    };
  }

  /**
   * Storm Surge offer accept. Records the operator's choice on the job's
   * notes for audit; the full state-machine wiring (rate adjustment, etc.)
   * is a follow-up build per the spec.
   */
  @Post('storm-surge-offer/:jobId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptStormSurge(
    @ZodParam(z.object({ jobId: z.string().uuid() })) params: { jobId: string },
  ): Promise<{ jobId: string; accepted: true }> {
    await this.admin.runAsAdmin({}, async (_db, client) => {
      const res = await client.query(
        `UPDATE jobs SET notes = COALESCE(notes, '') || E'\nstorm-surge: accepted', updated_at = now() WHERE id = $1`,
        [params.jobId],
      );
      if (res.rowCount === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
      }
    });
    return { jobId: params.jobId, accepted: true };
  }

  @Post('storm-surge-offer/:jobId/decline')
  @HttpCode(HttpStatus.OK)
  async declineStormSurge(
    @ZodParam(z.object({ jobId: z.string().uuid() })) params: { jobId: string },
  ): Promise<{ jobId: string; declined: true }> {
    await this.admin.runAsAdmin({}, async (_db, client) => {
      const res = await client.query(
        `UPDATE jobs SET notes = COALESCE(notes, '') || E'\nstorm-surge: declined', updated_at = now() WHERE id = $1`,
        [params.jobId],
      );
      if (res.rowCount === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
      }
    });
    return { jobId: params.jobId, declined: true };
  }

  /**
   * Test-only outbox view. Returns the in-memory record of everything
   * AgeroStubProvider was asked to push. Disabled outside test/dev.
   */
  @Public()
  @Get('_test/outbox')
  outbox(): Array<{ op: string; externalId: string; at: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('outbox view disabled in production');
    }
    return this.stub.getOutbox().map(({ op, externalId, at }) => ({ op, externalId, at }));
  }
}

function parseDynPricingSettings(settings: unknown) {
  const obj = (settings as Record<string, unknown> | null) ?? null;
  const candidate = obj?.dynamicPricing ?? {};
  const parsed = dynamicPricingTenantSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : dynamicPricingTenantSettingsSchema.parse({});
}
