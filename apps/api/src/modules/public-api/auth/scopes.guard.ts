/**
 * ScopeGuard — authorization for /v1. Runs after ApiKeyGuard (which attaches
 * req.apiKey). The route's @Scopes(...) list must be a subset of the key's
 * granted scopes, else 403 insufficient_scope.
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ApiScope, ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { SCOPES_KEY } from './scopes.decorator.js';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiScope[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const granted = new Set(req.apiKey?.scopes ?? []);
    const missing = required.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: ERROR_CODES.INSUFFICIENT_SCOPE,
        message: `API key is missing required scope(s): ${missing.join(', ')}`,
      });
    }
    return true;
  }
}
