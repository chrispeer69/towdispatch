/**
 * ApiKeyGuard — authentication for the /v1 public REST surface.
 *
 * /v1 controllers are marked @Public() so the global JwtAuthGuard skips them;
 * this guard takes over: it resolves the Bearer key to a tenant + scopes,
 * enforces the per-key rate limit, and writes the tenant context onto the
 * request so every downstream query runs RLS-isolated. The actor is the user
 * who minted the key (api_keys.created_by), so audit_log attributes writes.
 *
 * Authn here, authz in ScopeGuard. Do NOT add @Roles to /v1 controllers — the
 * session role grid does not apply to key-authenticated traffic.
 */
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { type ApiScope, ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimiterService } from '../../redis/rate-limiter.service.js';
import { ApiKeyAuthService } from './api-key-auth.service.js';
import { bearerToken } from './api-key.util.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by ApiKeyGuard on /v1 routes. */
    apiKey?: { id: string; scopes: ApiScope[] };
  }
}

type RequestContextTenantId = FastifyRequest['requestContext']['tenantId'];
type RequestContextUserId = FastifyRequest['requestContext']['userId'];

const RATE_LIMIT_WINDOW_SECONDS = 60;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly auth: ApiKeyAuthService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      throw new HttpException(
        { code: ERROR_CODES.API_KEY_INVALID, message: 'Missing API key' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const key = await this.auth.resolve(token);

    // Per-key sliding window (60s). Keyed by id, not prefix, so a rotated key
    // gets a fresh budget.
    const rl = await this.rateLimiter.check(
      `apikey:${key.id}`,
      key.rateLimitPerMin,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rl.allowed) {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      throw new HttpException(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Rate limit of ${key.rateLimitPerMin}/min exceeded`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    req.requestContext.tenantId = key.tenantId as RequestContextTenantId;
    req.requestContext.userId = key.createdBy as RequestContextUserId;
    req.requestContext.role = null;
    req.apiKey = { id: key.id, scopes: key.scopes };

    // Best-effort usage stamp; never blocks the request.
    void this.auth.touchLastUsed(key.id);
    return true;
  }
}
