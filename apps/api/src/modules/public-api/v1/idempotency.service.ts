/**
 * IdempotencyService — replay cache for /v1 writes (Session 29).
 *
 * When a consumer supplies an `Idempotency-Key` header, the first successful
 * response is persisted keyed by (tenant_id, idempotency_key). A repeat with
 * the SAME request fingerprint replays the stored body; a DIFFERENT
 * fingerprint is a 409 (the key was reused for a different request). The
 * unique index closes the concurrent-double-submit window: the loser of the
 * insert race re-reads and replays.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { apiIdempotencyKeys, uuidv7 } from '@ustowdispatch/db';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { PublicCallerCtx } from './public-v1.service.js';

const PG_UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (e: unknown): boolean =>
  Boolean(e && typeof e === 'object' && (e as { code?: string }).code === PG_UNIQUE_VIOLATION);

@Injectable()
export class IdempotencyService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Run `work` at most once per (tenant, idempotencyKey). When `idempotencyKey`
   * is undefined the call is a passthrough. `fingerprint` is a hash of the
   * request (method+path+body); a mismatch on an existing key is a conflict.
   */
  async run<T>(
    ctx: PublicCallerCtx,
    apiKeyId: string,
    idempotencyKey: string | undefined,
    fingerprint: string,
    responseStatus: number,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!idempotencyKey) return work();

    const existing = await this.lookup(ctx, idempotencyKey);
    if (existing) return this.replay<T>(existing, fingerprint);

    const result = await work();

    try {
      await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
        await tx.insert(apiIdempotencyKeys).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          apiKeyId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          responseStatus,
          responseBody: result as unknown as Record<string, unknown>,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Concurrent request won the insert — replay its stored response.
        const won = await this.lookup(ctx, idempotencyKey);
        if (won) return this.replay<T>(won, fingerprint);
      }
      throw err;
    }
    return result;
  }

  private async lookup(
    ctx: PublicCallerCtx,
    idempotencyKey: string,
  ): Promise<{ requestFingerprint: string; responseBody: unknown } | null> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.apiIdempotencyKeys.findFirst({
        where: and(
          eq(apiIdempotencyKeys.tenantId, ctx.tenantId),
          eq(apiIdempotencyKeys.idempotencyKey, idempotencyKey),
          isNull(apiIdempotencyKeys.deletedAt),
        ),
        columns: { requestFingerprint: true, responseBody: true },
      });
      return row ?? null;
    });
  }

  private replay<T>(
    row: { requestFingerprint: string; responseBody: unknown },
    fingerprint: string,
  ): T {
    if (row.requestFingerprint !== fingerprint) {
      throw new ConflictException({
        code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
        message: 'Idempotency-Key was already used for a different request',
      });
    }
    return row.responseBody as T;
  }
}

function toTenantCtx(ctx: PublicCallerCtx): {
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
