import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PortalAuthContext } from './portal-auth.guard.js';

/**
 * @CurrentPortalUser() — pull the portal identity off a route guarded by
 * PortalAuthGuard. Throws if the guard didn't run first (surfaces an
 * endpoint-misconfig as a clear 500, not a silent undefined).
 */
export const CurrentPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalAuthContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.portalAuth) {
      throw new Error('CurrentPortalUser used on a route without PortalAuthGuard');
    }
    return req.portalAuth;
  },
);
