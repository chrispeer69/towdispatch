/**
 * Global JWT auth guard.
 * - Reads `Authorization: Bearer <jwt>`.
 * - Verifies signature, issuer, audience, and expiry.
 * - Mutates the request context with tenantId/userId/role.
 * - Skips routes marked @Public().
 *
 * Fails CLOSED. If the @Public() metadata isn't present and the token is
 * missing or invalid, the request is rejected with 401.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type AccessTokenClaims,
  ERROR_CODES,
  accessTokenClaimsSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '../../config/config.service.js';
import { JwtService } from '../../modules/auth/jwt.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    let claims: AccessTokenClaims;
    try {
      const decoded = await this.jwt.verifyAccess(raw);
      claims = accessTokenClaimsSchema.parse(decoded);
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired access token',
      });
    }

    if (claims.iss !== this.config.jwt.issuer || claims.aud !== this.config.jwt.audience) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Token issuer or audience mismatch',
      });
    }

    req.requestContext.tenantId = claims.tid as RequestContextTenantId;
    req.requestContext.userId = claims.sub as RequestContextUserId;
    req.requestContext.role = claims.role;
    return true;
  }
}

type RequestContextTenantId = FastifyRequest['requestContext']['tenantId'];
type RequestContextUserId = FastifyRequest['requestContext']['userId'];
