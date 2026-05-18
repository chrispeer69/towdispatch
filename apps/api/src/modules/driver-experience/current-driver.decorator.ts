import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { DriverAuthContext } from './driver-auth.guard.js';

/**
 * @CurrentDriver() — pull the driver identity off a route guarded by
 * DriverAuthGuard. Throws if the guard didn't run first (caught at the
 * controller level so endpoint-misconfig surfaces as a 500 with a clear
 * server log, not a silent undefined).
 */
export const CurrentDriver = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DriverAuthContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.driverAuth) {
      throw new Error('CurrentDriver used on a route without DriverAuthGuard');
    }
    return req.driverAuth;
  },
);
