/**
 * CapacityPartnerKeyGuard — Bearer-key auth for the partner pull API
 * (GET /v1/capacity*). Same key format + constant-time verification as the
 * public API (api-key.util), but resolved against capacity_partners: a
 * capacity key grants exactly the capacity read surface, nothing else.
 *
 * Rate limit: fixed 60 req/min per partner key. Every authenticated request
 * is access-logged (partner id, tenant, route) — the pull surface has no
 * write path, so the audit trail is the structured log stream.
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { capacityPartners } from '@ustowdispatch/db';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import {
  bearerToken,
  hashApiKey,
  hashesEqual,
  parseApiKey,
} from '../../public-api/auth/api-key.util.js';
import { RateLimiterService } from '../../redis/rate-limiter.service.js';

export interface ResolvedCapacityPartner {
  partnerId: string;
  tenantId: string;
  name: string;
  classVisibility: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by CapacityPartnerKeyGuard on /v1/capacity routes. */
    capacityPartner?: ResolvedCapacityPartner;
  }
}

const RATE_LIMIT_PER_MIN = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

@Injectable()
export class CapacityPartnerKeyGuard implements CanActivate {
  private readonly log = new Logger(CapacityPartnerKeyGuard.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw invalidKey();

    const parsed = parseApiKey(token);
    if (!parsed) throw invalidKey();

    // Admin pool: at auth time the tenant is unknown; the indexed prefix
    // lookup is the only cross-RLS read (same tradeoff as ApiKeyAuthService).
    const row = await this.admin.runAsAdmin({}, async (db) =>
      db.query.capacityPartners.findFirst({
        where: and(
          eq(capacityPartners.apiKeyPrefix, parsed.prefix),
          isNull(capacityPartners.deletedAt),
        ),
      }),
    );
    if (!row || !row.apiKeyHash) throw invalidKey();
    if (!hashesEqual(hashApiKey(token), row.apiKeyHash)) throw invalidKey();
    if (!row.enabled) {
      throw new ForbiddenException({
        code: ERROR_CODES.CAPACITY_PARTNER_DISABLED,
        message: 'This partner is disabled',
      });
    }

    const rl = await this.rateLimiter.check(
      `capacity-partner:${row.id}`,
      RATE_LIMIT_PER_MIN,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rl.allowed) {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      throw new HttpException(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Rate limit of ${RATE_LIMIT_PER_MIN}/min exceeded`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    req.capacityPartner = {
      partnerId: row.id,
      tenantId: row.tenantId,
      name: row.name,
      classVisibility: row.classVisibility,
    };
    // Access audit — the pull surface is read-only, so the structured log
    // (shipped with the rest of the request logs) is the access trail.
    this.log.log({
      msg: 'capacity pull access',
      partnerId: row.id,
      tenantId: row.tenantId,
      url: req.url,
    });
    return true;
  }
}

function invalidKey(): UnauthorizedException {
  return new UnauthorizedException({
    code: ERROR_CODES.API_KEY_INVALID,
    message: 'Invalid or revoked API key',
  });
}
