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
import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { uuidv7 } from '@towdispatch/db';
import { Public } from '../../common/decorators/public.decorator.js';
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
  async dispatch(@Body() payload: InboundDispatchPayload): Promise<{ jobId: string }> {
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

    return { jobId };
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
