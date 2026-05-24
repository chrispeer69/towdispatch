/**
 * BidderJwtGuard — validates the bidder session JWT issued by
 * /bidder-auth/login (Session 33).
 *
 * Bidder routes are marked @Public() so the global JwtAuthGuard does not
 * try to verify them as operator access tokens. This guard then runs and
 * either populates the request context with the bidder's identity or
 * rejects 401. The bidder issuer is fully separated (different signing key,
 * audience suffix `…-bidder`) so a leaked operator/driver token cannot
 * masquerade as a bidder, and vice-versa. Mirrors DriverAuthGuard.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { JwtService } from '../../auth/jwt.service.js';

export interface BidderAuthContext {
  bidderId: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    bidderAuth?: BidderAuthContext;
  }
}

@Injectable()
export class BidderJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing bidder bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    try {
      const claims = await this.jwt.verifyBidder(raw);
      req.bidderAuth = { bidderId: claims.bidderId, tenantId: claims.tid };
      // Mirror onto requestContext so downstream services that read
      // request.requestContext.tenantId still see it. userId is the
      // bidderId — there is no users row for a bidder and audit_log.actor_id
      // has no FK constraint.
      req.requestContext.tenantId = claims.tid as FastifyRequest['requestContext']['tenantId'];
      req.requestContext.userId = claims.bidderId as FastifyRequest['requestContext']['userId'];
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired bidder token',
      });
    }
  }
}
