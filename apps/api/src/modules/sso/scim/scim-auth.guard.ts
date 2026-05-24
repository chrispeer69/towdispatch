/**
 * ScimAuthGuard — bearer-token auth for the SCIM 2.0 surface.
 *
 * The SCIM request carries no JWT and no tenant context, so we resolve the
 * tenant from the token itself: sha256(plain) is looked up against the
 * globally-unique scim_tokens.token_hash via the admin pool (RLS-bypassing),
 * which yields the tenant. We then enforce the env gate (ENTERPRISE_SSO_*)
 * and stamp the resolved ScimContext on the request for the controller.
 *
 * Fails closed: missing/invalid/expired/revoked token => 401 scim_token_invalid.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { scimTokens } from '@ustowdispatch/db/schema';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '../../../config/config.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { hashToken } from '../../auth/auth-tokens.util.js';
import type { ScimContext } from './scim.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    scimContext?: ScimContext;
  }
}

const unauthorized = (message: string): UnauthorizedException =>
  new UnauthorizedException({ code: ERROR_CODES.SCIM_TOKEN_INVALID, message });

@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw unauthorized('Missing SCIM bearer token');
    }
    const plain = auth.slice('bearer '.length).trim();
    if (plain.length === 0) throw unauthorized('Empty SCIM bearer token');
    const tokenHash = hashToken(plain);

    const row = await this.admin.runAsAdmin({}, async (db) => {
      const found = await db.query.scimTokens.findFirst({
        where: and(
          eq(scimTokens.tokenHash, tokenHash),
          isNull(scimTokens.deletedAt),
          isNull(scimTokens.revokedAt),
        ),
      });
      if (!found) return null;
      // Touch last_used_at (best-effort within the same admin tx).
      await db
        .update(scimTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(scimTokens.id, found.id));
      return found;
    });

    if (!row) throw unauthorized('Invalid SCIM token');
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw unauthorized('Expired SCIM token');
    }

    // Env gate: a token for a disabled / non-allowlisted tenant is inert.
    const gate = this.config.enterpriseSso;
    if (!gate.enabled || !gate.isTenantAllowed(row.tenantId)) {
      throw unauthorized('SCIM is not enabled for this tenant');
    }

    const ctx: ScimContext = {
      tenantId: row.tenantId,
      connectionId: row.connectionId,
      requestId: req.requestContext?.requestId ?? '',
    };
    req.scimContext = ctx;
    return true;
  }
}
