/**
 * ApiKeyAuthService — resolves a presented Bearer key to its tenant + scopes.
 *
 * Runs on the ADMIN pool: at auth time we don't yet know the tenant, so the
 * prefix lookup must cross RLS. Once resolved, every downstream query runs
 * under the resolved tenant's context via TenantAwareDb, so RLS still isolates
 * all data access — only this single indexed prefix lookup is admin-scoped.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { apiKeys } from '@ustowdispatch/db';
import { type ApiScope, ERROR_CODES, apiScopeValues } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { hashApiKey, hashesEqual, parseApiKey } from './api-key.util.js';

export interface ResolvedApiKey {
  id: string;
  tenantId: string;
  createdBy: string;
  scopes: ApiScope[];
  rateLimitPerMin: number;
}

@Injectable()
export class ApiKeyAuthService {
  constructor(private readonly admin: TransactionRunner) {}

  /** Resolve + validate a raw bearer token. Throws 401 on any failure. */
  async resolve(rawToken: string): Promise<ResolvedApiKey> {
    const parsed = parseApiKey(rawToken);
    if (!parsed) throw invalidKey();

    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.apiKeys.findFirst({
        where: and(eq(apiKeys.prefix, parsed.prefix), isNull(apiKeys.deletedAt)),
      }),
    );
    if (!row) throw invalidKey();

    // Constant-time hash comparison — never branch on the raw key.
    if (!hashesEqual(hashApiKey(rawToken), row.keyHash)) throw invalidKey();
    if (row.revokedAt) throw invalidKey();
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw expiredKey();

    return {
      id: row.id,
      tenantId: row.tenantId,
      createdBy: row.createdBy,
      scopes: sanitizeScopes(row.scopes),
      rateLimitPerMin: row.rateLimitPerMin,
    };
  }

  /** Best-effort last_used_at stamp. Failures must not block the request. */
  async touchLastUsed(id: string): Promise<void> {
    try {
      await this.admin.runAsAdmin({}, async (db) =>
        db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id)),
      );
    } catch {
      /* swallow — telemetry only */
    }
  }
}

function sanitizeScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(apiScopeValues);
  return raw.filter((s): s is ApiScope => typeof s === 'string' && allowed.has(s));
}

function invalidKey(): UnauthorizedException {
  return new UnauthorizedException({
    code: ERROR_CODES.API_KEY_INVALID,
    message: 'Invalid or revoked API key',
  });
}

function expiredKey(): UnauthorizedException {
  return new UnauthorizedException({
    code: ERROR_CODES.API_KEY_EXPIRED,
    message: 'API key has expired',
  });
}
