import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { DeveloperAuthContext } from './developer-auth.guard.js';

/**
 * @CurrentDeveloper() — pull the developer identity off a route guarded by
 * DeveloperAuthGuard. Throws if the guard didn't run first so an
 * endpoint-misconfig surfaces as a 500 with a clear log, not a silent undefined.
 */
export const CurrentDeveloper = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeveloperAuthContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.developerAuth) {
      throw new Error('CurrentDeveloper used on a route without DeveloperAuthGuard');
    }
    return req.developerAuth;
  },
);
