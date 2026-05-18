/**
 * DriverAuthGuard — validates the driver-app session JWT issued by
 * /driver-auth/login.
 *
 * Driver routes are marked @Public() so the global JwtAuthGuard does not
 * try to verify them as operator access tokens. This guard then runs and
 * either populates the request context with the driver's identity or
 * rejects 401. Keeping the two issuers fully separated (different signing
 * key, different audience suffix) means a leaked operator token cannot
 * masquerade as a driver, and vice-versa.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { JwtService } from '../auth/jwt.service.js';

export interface DriverAuthContext {
  driverId: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    driverAuth?: DriverAuthContext;
  }
}

@Injectable()
export class DriverAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing driver bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    try {
      const claims = await this.jwt.verifyDriver(raw);
      req.driverAuth = { driverId: claims.driverId, tenantId: claims.tid };
      // Mirror onto requestContext so downstream services that read
      // request.requestContext.tenantId (audit, rate-limiter) still see it.
      // userId is set to driverId — there is no users row for a PIN-auth'd
      // driver and audit_log.actor_id has no FK constraint.
      req.requestContext.tenantId = claims.tid as FastifyRequest['requestContext']['tenantId'];
      req.requestContext.userId = claims.driverId as FastifyRequest['requestContext']['userId'];
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired driver token',
      });
    }
  }
}
