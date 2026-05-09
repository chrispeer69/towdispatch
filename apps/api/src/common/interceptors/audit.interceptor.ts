/**
 * AuditInterceptor is a no-op at the interceptor layer — the audit row is
 * actually written by the fn_audit_log() Postgres trigger. The interceptor
 * exists to enforce two invariants:
 *
 *   1) For non-GET requests on protected routes, the request MUST have a
 *      tenantId + userId on the context by the time the controller runs.
 *      If those are missing, we refuse the request before any DB write.
 *      Without this, a state change could escape the audit trigger when
 *      the GUCs aren't set (e.g. an anonymous transaction).
 *
 *   2) Provides a single seam where future cross-cutting audit concerns
 *      (rate-limited write counters, suspicious-activity heuristics) can hook
 *      in without modifying every controller.
 */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

const READONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!READONLY_METHODS.has(req.method)) {
      const c = req.requestContext;
      if (!c?.tenantId || !c?.userId) {
        throw new UnauthorizedException({
          code: ERROR_CODES.TENANT_CONTEXT_MISSING,
          message: 'State-changing requests require tenant + user context',
        });
      }
    }
    return next.handle();
  }
}
