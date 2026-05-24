/**
 * ApiKeysService — operator-facing CRUD for API keys (session-auth'd).
 * Tenant-isolated via TenantAwareDb. The full key is returned exactly once,
 * from create(); thereafter only the prefix is ever surfaced.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { apiKeys, uuidv7 } from '@ustowdispatch/db';
import {
  type ApiKeyDto,
  type ApiScope,
  type CreateApiKeyPayload,
  type CreateApiKeyResult,
  ERROR_CODES,
  apiScopeValues,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../../config/config.service.js';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { generateApiKey } from '../auth/api-key.util.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
  ) {}

  async list(ctx: CallerCtx): Promise<ApiKeyDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.apiKeys.findMany({
        where: isNull(apiKeys.deletedAt),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      return rows.map(toApiKeyDto);
    });
  }

  async create(ctx: CallerCtx, input: CreateApiKeyPayload): Promise<CreateApiKeyResult> {
    const generated = generateApiKey('live');
    const rateLimitPerMin = input.rateLimitPerMin ?? this.config.publicApi.defaultRateLimitPerMin;
    const row = await this.db.runInTenantContext(ctx, async (tx) => {
      const [r] = await tx
        .insert(apiKeys)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          prefix: generated.prefix,
          keyHash: generated.hash,
          scopes: input.scopes,
          rateLimitPerMin,
          createdBy: ctx.userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();
      if (!r) throw new Error('createApiKey: insert returning() yielded no row');
      return r;
    });
    return { apiKey: toApiKeyDto(row), plaintextKey: generated.plaintext };
  }

  async revoke(ctx: CallerCtx, id: string): Promise<ApiKeyDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.apiKeys.findFirst({
        where: and(eq(apiKeys.id, id), isNull(apiKeys.deletedAt)),
      });
      if (!existing) throw notFound();
      if (existing.revokedAt) return toApiKeyDto(existing); // idempotent
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(apiKeys.id, id))
        .returning();
      if (!row) throw notFound();
      return toApiKeyDto(row);
    });
  }
}

function sanitizeScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(apiScopeValues);
  return raw.filter((s): s is ApiScope => typeof s === 'string' && allowed.has(s));
}

function toApiKeyDto(row: typeof apiKeys.$inferSelect): ApiKeyDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    prefix: row.prefix,
    scopes: sanitizeScopes(row.scopes),
    rateLimitPerMin: row.rateLimitPerMin,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'API key not found' });
}
