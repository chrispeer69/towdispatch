/**
 * MarketplaceTokenGuard (Session 46) — authenticates a third-party app's
 * opaque OAuth access token on the public resource surface (/v1/*).
 *
 * Flow per request:
 *   1. Read `Authorization: Bearer usto_at_…`.
 *   2. sha256 the token and resolve the install via the ADMIN pool — there is
 *      no tenant context yet, so RLS can't be used to find the row; the unique
 *      hash index makes it O(1).
 *   3. Reject if: not found, install uninstalled/soft-deleted, access token
 *      expired, or the owning app is suspended/deleted.
 *   4. Enforce @RequireScopes — every required scope must be in scopes_granted.
 *   5. Attach req.appToken (tenant, app, install, scopes) AND set
 *      requestContext.tenantId/userId so downstream tenant-context work and the
 *      audit trail attribute the call to (tenant, app). The token is NEVER
 *      tenant-elevated: it can only ever act within scopes_granted for its own
 *      install's tenant.
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type MarketplaceScope, type TokenIdentity } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { hashSecret } from './marketplace-tokens.util.js';
import { MARKETPLACE_SCOPES_KEY } from './require-scopes.decorator.js';

declare module 'fastify' {
  interface FastifyRequest {
    appToken?: TokenIdentity;
  }
}

interface InstallRow {
  install_id: string;
  tenant_id: string;
  app_id: string;
  app_slug: string;
  app_status: string;
  scopes_granted: string[];
  access_token_expires_at: Date | null;
}

@Injectable()
export class MarketplaceTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admin: TransactionRunner,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing app access token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    const identity = await this.resolve(raw);
    if (!identity) {
      throw new UnauthorizedException({
        code: ERROR_CODES.OAUTH_INVALID_GRANT,
        message: 'Invalid, expired, or revoked access token',
      });
    }

    const required = this.reflector.getAllAndOverride<MarketplaceScope[]>(MARKETPLACE_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const granted = new Set(identity.scopes);
      const missing = required.filter((s) => !granted.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: ERROR_CODES.MARKETPLACE_SCOPE_NOT_GRANTED,
          message: `Missing required scope(s): ${missing.join(', ')}`,
        });
      }
    }

    req.appToken = identity;
    req.requestContext.tenantId = identity.tenantId as FastifyRequest['requestContext']['tenantId'];
    // Attribute audited writes to the app's install (no operator user behind it).
    req.requestContext.userId = identity.installId as FastifyRequest['requestContext']['userId'];
    return true;
  }

  /** Resolve an access token to its install identity, or null if unusable. */
  private async resolve(plain: string): Promise<TokenIdentity | null> {
    const tokenHash = hashSecret(plain);
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<InstallRow>(
        `SELECT i.id AS install_id, i.tenant_id, i.app_id, i.scopes_granted,
                i.access_token_expires_at, a.slug AS app_slug, a.status AS app_status
           FROM marketplace_app_installs i
           JOIN marketplace_apps a ON a.id = i.app_id AND a.deleted_at IS NULL
          WHERE i.oauth_access_token_hash = $1
            AND i.status = 'active'
            AND i.deleted_at IS NULL
          LIMIT 1`,
        [tokenHash],
      );
      return r.rows[0] ?? null;
    });
    if (!row) return null;
    if (row.app_status === 'suspended') return null;
    if (row.access_token_expires_at && row.access_token_expires_at.getTime() <= Date.now()) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      appId: row.app_id,
      appSlug: row.app_slug,
      installId: row.install_id,
      scopes: Array.isArray(row.scopes_granted) ? row.scopes_granted : [],
    };
  }
}
