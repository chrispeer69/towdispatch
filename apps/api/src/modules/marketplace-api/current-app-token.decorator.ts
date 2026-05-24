import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { TokenIdentity } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';

/**
 * @CurrentAppToken() — pull the resolved marketplace access-token identity
 * (tenant, app, install, granted scopes) off a route guarded by
 * MarketplaceTokenGuard. Throws if the guard didn't run first.
 */
export const CurrentAppToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenIdentity => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.appToken) {
      throw new Error('CurrentAppToken used on a route without MarketplaceTokenGuard');
    }
    return req.appToken;
  },
);
