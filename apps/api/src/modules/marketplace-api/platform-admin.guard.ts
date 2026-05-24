/**
 * PlatformAdminGuard (Session 46) — gates the app-review endpoints
 * (/marketplace-admin/*). v1 has no platform-admin RBAC role, so review is an
 * internal ops operation authenticated by a shared secret
 * (MARKETPLACE_ADMIN_TOKEN), compared in constant time. When the env var is
 * unset the endpoints are hard-disabled (403). See SESSION_46_DECISIONS.md —
 * this is the one piece slated to migrate to real platform-admin RBAC.
 */
import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.marketplaceAdminToken;
    if (!expected) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Platform admin endpoints are disabled (MARKETPLACE_ADMIN_TOKEN unset)',
      });
    }
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    const presented = auth?.toLowerCase().startsWith('bearer ')
      ? auth.slice('bearer '.length).trim()
      : '';
    if (!constantTimeEquals(presented, expected)) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Invalid platform admin token',
      });
    }
    return true;
  }
}

/** Length-independent constant-time string compare. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare bb to itself to keep timing independent of which arg is longer.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
