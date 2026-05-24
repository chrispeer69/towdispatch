/**
 * DeveloperAuthGuard (Session 46) — validates the marketplace developer-portal
 * JWT issued by /developers/login.
 *
 * Developer routes are marked @Public() so the global JwtAuthGuard doesn't try
 * to verify them as operator access tokens. This guard then runs and either
 * populates req.developerAuth or rejects 401. A developer is a GLOBAL actor
 * (not tenant-scoped) so it sets NO tenant context — developer services use
 * the admin pool against the global app/developer tables.
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

export interface DeveloperAuthContext {
  developerId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    developerAuth?: DeveloperAuthContext;
  }
}

@Injectable()
export class DeveloperAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing developer bearer token',
      });
    }
    const raw = auth.slice('bearer '.length).trim();
    try {
      const claims = await this.jwt.verifyDeveloper(raw);
      req.developerAuth = { developerId: claims.sub };
      return true;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired developer token',
      });
    }
  }
}
