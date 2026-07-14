/**
 * CapacityPartnersService — partner registry CRUD + credential lifecycle.
 *
 * Credentials are shown exactly once, at creation or rotation:
 *   - webhook secret: whsec_* minted by WebhookSecretCipher, AES-256-GCM
 *     at rest (the worker must decrypt it to sign outbound payloads).
 *   - pull-API key: tc_<env>_<prefix>_<secret> from the public-api key
 *     util; only prefix + pbkdf2 hash persist.
 * Webhook URLs are SSRF-vetted (DNS included) before they're accepted.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type CapacityPartner, capacityPartners, uuidv7 } from '@ustowdispatch/db';
import type {
  CapacityPartnerCredentials,
  CapacityPartnerDto,
  CreateCapacityPartnerPayload,
  UpdateCapacityPartnerPayload,
} from '@ustowdispatch/shared';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { generateApiKey } from '../public-api/auth/api-key.util.js';
import { WebhookSecretCipher } from '../public-api/crypto/webhook-secret-cipher.service.js';
import { urlProblem } from './webhook-url.guard.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class CapacityPartnersService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly cipher: WebhookSecretCipher,
    private readonly config: ConfigService,
  ) {}

  async list(ctx: CallerCtx): Promise<CapacityPartnerDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.capacityPartners.findMany({
        where: isNull(capacityPartners.deletedAt),
        orderBy: (p, { asc }) => [asc(p.name)],
      });
      return rows.map(toPartnerDto);
    });
  }

  async create(
    ctx: CallerCtx,
    input: CreateCapacityPartnerPayload,
  ): Promise<CapacityPartnerCredentials> {
    if (input.deliveryMode === 'webhook') {
      if (!input.webhookUrl) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'A webhook URL is required for webhook delivery',
        });
      }
      await this.assertUrlAllowed(input.webhookUrl);
    }

    const webhookSecret = input.deliveryMode === 'webhook' ? this.cipher.generateSecret() : null;
    const apiKey = generateApiKey(this.config.nodeEnv === 'production' ? 'live' : 'test');

    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const dup = await tx.query.capacityPartners.findFirst({
        where: and(eq(capacityPartners.name, input.name), isNull(capacityPartners.deletedAt)),
        columns: { id: true },
      });
      if (dup) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `A partner named "${input.name}" already exists`,
        });
      }
      const [inserted] = await tx
        .insert(capacityPartners)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          networkCode: input.networkCode,
          deliveryMode: input.deliveryMode,
          webhookUrl: input.webhookUrl ?? null,
          webhookSecretEncrypted: webhookSecret ? this.cipher.encrypt(webhookSecret) : null,
          apiKeyPrefix: apiKey.prefix,
          apiKeyHash: apiKey.hash,
          enabled: true,
          classVisibility: [...input.classVisibility],
          createdBy: ctx.userId,
        })
        .returning();
      if (!inserted) throw new Error('createPartner: insert returned no row');
      return inserted;
    });

    return { partner: toPartnerDto(row), webhookSecret, apiKey: apiKey.plaintext };
  }

  async update(
    ctx: CallerCtx,
    partnerId: string,
    input: UpdateCapacityPartnerPayload,
  ): Promise<CapacityPartnerDto> {
    if (input.webhookUrl) await this.assertUrlAllowed(input.webhookUrl);

    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.capacityPartners.findFirst({
        where: and(eq(capacityPartners.id, partnerId), isNull(capacityPartners.deletedAt)),
      });
      if (!existing) return null;

      // Webhook mode requires a URL AND a signing secret (DB CHECK
      // capacity_partners_webhook_complete) — surface a 400 here instead
      // of letting the constraint bubble up as a 500. Converting a
      // pull-only partner: rotate a secret first (that endpoint returns
      // the new secret; this one has nowhere to show it), then PATCH.
      const effectiveMode = input.deliveryMode ?? existing.deliveryMode;
      const effectiveUrl = input.webhookUrl === undefined ? existing.webhookUrl : input.webhookUrl;
      if (effectiveMode === 'webhook') {
        if (!effectiveUrl) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'A webhook URL is required for webhook delivery',
          });
        }
        if (!existing.webhookSecretEncrypted) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message:
              'Rotate a webhook signing secret for this partner before switching to webhook delivery',
          });
        }
      }

      const patch: Partial<typeof capacityPartners.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.networkCode !== undefined) patch.networkCode = input.networkCode;
      if (input.deliveryMode !== undefined) patch.deliveryMode = input.deliveryMode;
      if (input.webhookUrl !== undefined) patch.webhookUrl = input.webhookUrl;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.classVisibility !== undefined) patch.classVisibility = [...input.classVisibility];

      const [updated] = await tx
        .update(capacityPartners)
        .set(patch)
        .where(and(eq(capacityPartners.id, partnerId), isNull(capacityPartners.deletedAt)))
        .returning();
      return updated ?? null;
    });
    if (!row) throw partnerNotFound();
    return toPartnerDto(row);
  }

  async softDelete(ctx: CallerCtx, partnerId: string): Promise<void> {
    const done = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [updated] = await tx
        .update(capacityPartners)
        .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
        .where(and(eq(capacityPartners.id, partnerId), isNull(capacityPartners.deletedAt)))
        .returning({ id: capacityPartners.id });
      return updated ?? null;
    });
    if (!done) throw partnerNotFound();
  }

  /** Mint a fresh webhook signing secret; the old one stops working immediately. */
  async rotateWebhookSecret(
    ctx: CallerCtx,
    partnerId: string,
  ): Promise<CapacityPartnerCredentials> {
    const secret = this.cipher.generateSecret();
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [updated] = await tx
        .update(capacityPartners)
        .set({ webhookSecretEncrypted: this.cipher.encrypt(secret), updatedAt: new Date() })
        .where(and(eq(capacityPartners.id, partnerId), isNull(capacityPartners.deletedAt)))
        .returning();
      return updated ?? null;
    });
    if (!row) throw partnerNotFound();
    return { partner: toPartnerDto(row), webhookSecret: secret, apiKey: null };
  }

  /** Mint a fresh pull-API key; the old key is invalid immediately. */
  async rotateApiKey(ctx: CallerCtx, partnerId: string): Promise<CapacityPartnerCredentials> {
    const apiKey = generateApiKey(this.config.nodeEnv === 'production' ? 'live' : 'test');
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [updated] = await tx
        .update(capacityPartners)
        .set({ apiKeyPrefix: apiKey.prefix, apiKeyHash: apiKey.hash, updatedAt: new Date() })
        .where(and(eq(capacityPartners.id, partnerId), isNull(capacityPartners.deletedAt)))
        .returning();
      return updated ?? null;
    });
    if (!row) throw partnerNotFound();
    return { partner: toPartnerDto(row), webhookSecret: null, apiKey: apiKey.plaintext };
  }

  private async assertUrlAllowed(url: string): Promise<void> {
    const problem = await urlProblem(url, {
      allowLoopback: this.config.nodeEnv !== 'production',
    });
    if (problem) {
      throw new BadRequestException({
        code: ERROR_CODES.CAPACITY_WEBHOOK_URL_FORBIDDEN,
        message: `Webhook URL rejected: ${problem}`,
      });
    }
  }

  private toTenantCtx(ctx: CallerCtx): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

function toPartnerDto(row: CapacityPartner): CapacityPartnerDto {
  return {
    id: row.id,
    name: row.name,
    networkCode: row.networkCode as CapacityPartnerDto['networkCode'],
    deliveryMode: row.deliveryMode,
    webhookUrl: row.webhookUrl,
    apiKeyPrefix: row.apiKeyPrefix,
    enabled: row.enabled,
    classVisibility: row.classVisibility as CapacityPartnerDto['classVisibility'],
    lastBroadcastAt: row.lastBroadcastAt ? row.lastBroadcastAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function partnerNotFound(): NotFoundException {
  return new NotFoundException({
    code: ERROR_CODES.NOT_FOUND,
    message: 'Partner not found',
  });
}
