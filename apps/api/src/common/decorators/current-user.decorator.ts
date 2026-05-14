import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestContext } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';

export const CurrentRequestContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    return req.requestContext;
  },
);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const c = req.requestContext;
  if (!c.userId) {
    throw new Error('CurrentUser used on a route with no authenticated user');
  }
  return { id: c.userId, role: c.role, tenantId: c.tenantId };
});

export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const c = req.requestContext;
  if (!c.tenantId) {
    throw new Error('CurrentTenant used on a route with no tenant context');
  }
  return { id: c.tenantId };
});
