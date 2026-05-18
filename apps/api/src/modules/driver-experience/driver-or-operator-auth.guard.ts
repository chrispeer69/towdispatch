/**
 * DriverOrOperatorAuthGuard — accepts either a driver-app JWT
 * (DriverAuthGuard) or a live operator session (the global JwtAuthGuard
 * already populated requestContext.tenantId / userId / role before this
 * guard runs).
 *
 * Used by surfaces that BOTH the in-truck app and the back-office UI
 * need to hit — evidence presign, evidence list, dispatch's read-side of
 * a driver's recent uploads.
 *
 * The route must be marked @Public() so the global JwtAuthGuard does NOT
 * pre-reject it on a missing/invalid operator token. The dual guard then
 * accepts either credential.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AccessTokenClaims,
  ERROR_CODES,
  accessTokenClaimsSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '../../config/config.service.js';
import { JwtService } from '../auth/jwt.service.js';

@Injectable()
export class DriverOrOperatorAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();

    // Try driver first (cheaper, smaller payload). If that fails, try operator.
    try {
      const claims = await this.jwt.verifyDriver(raw);
      req.driverAuth = { driverId: claims.driverId, tenantId: claims.tid };
      req.requestContext.tenantId = claims.tid as FastifyRequest['requestContext']['tenantId'];
      req.requestContext.userId = claims.driverId as FastifyRequest['requestContext']['userId'];
      return true;
    } catch {
      /* fall through to operator */
    }

    try {
      const decoded = await this.jwt.verifyAccess(raw);
      const claims: AccessTokenClaims = accessTokenClaimsSchema.parse(decoded);
      if (claims.iss !== this.config.jwt.issuer || claims.aud !== this.config.jwt.audience) {
        throw new Error('issuer/audience mismatch');
      }
      req.requestContext.tenantId = claims.tid as FastifyRequest['requestContext']['tenantId'];
      req.requestContext.userId = claims.sub as FastifyRequest['requestContext']['userId'];
      req.requestContext.role = claims.role;
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired token',
      });
    }
  }
}
