/**
 * PortalAuthGuard — validates the customer-portal session JWT issued by
 * POST /portal/login.
 *
 * Portal routes are marked @Public() so the global JwtAuthGuard does not try
 * to verify them as operator access tokens. This guard then runs and either
 * populates the request with the portal user's identity (portal user id +
 * tenant + bound customer id) or rejects 401. Keeping the issuers fully
 * separated (different signing key, different audience suffix) means a leaked
 * operator or driver token cannot masquerade as a portal customer, and
 * vice-versa.
 *
 * NOTE: this guard authorizes by TENANT and identifies the bound CUSTOMER.
 * Cross-customer isolation (only the user's own customer's data) is enforced
 * in PortalAccountService using the customerId set here — never trust a
 * customer id from the request body.
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

export interface PortalAuthContext {
  portalUserId: string;
  customerId: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    portalAuth?: PortalAuthContext;
  }
}

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing portal bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    try {
      const claims = await this.jwt.verifyPortal(raw);
      req.portalAuth = {
        portalUserId: claims.sub,
        customerId: claims.cid,
        tenantId: claims.tid,
      };
      // Mirror onto requestContext so downstream tenant-scoped DB access and
      // the audit trigger see the tenant + actor. actor_id has no FK, so the
      // portal user id is a valid audit actor.
      req.requestContext.tenantId = claims.tid as FastifyRequest['requestContext']['tenantId'];
      req.requestContext.userId = claims.sub as FastifyRequest['requestContext']['userId'];
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired portal token',
      });
    }
  }
}
