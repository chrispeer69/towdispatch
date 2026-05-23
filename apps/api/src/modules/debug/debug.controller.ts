/**
 * GET /_debug/boom — guarded deliberate-error endpoint for the production
 * smoke harness (apps/e2e/production-smoke.spec.ts).
 *
 * Inert by default: returns 404 unless SMOKE_DEBUG_ERROR_ENABLED=true, so a
 * deploy that hasn't opted in behaves as if the route does not exist.
 * Requires a bearer token matching SMOKE_DEBUG_TOKEN (else 401). When both
 * gates pass it captures a Sentry event tagged smoke_test=true plus the
 * caller's marker, then throws a 500 so the spec can also assert the error
 * response.
 *
 * The Sentry event is captured HERE rather than via the global exception
 * filter: the filter only forwards non-HTTP `Error`s to Sentry, and this
 * handler throws an HttpException — so there is exactly one event, and it
 * carries the smoke_test tag. That keeps synthetic crashes out of on-call
 * paging (alert rules exclude smoke_test:true).
 */
import {
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { SentryService } from '../../common/observability/sentry.service.js';
import { ConfigService } from '../../config/config.service.js';

@Controller('_debug')
export class DebugController {
  constructor(
    private readonly config: ConfigService,
    private readonly sentry: SentryService,
  ) {}

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Get('boom')
  boom(
    @Query('marker') marker: string | undefined,
    @Headers('authorization') authHeader: string | undefined,
  ): never {
    const { enabled, token } = this.config.smokeDebug;
    if (!enabled || !token) {
      // Indistinguishable from a route that simply isn't mounted.
      throw new NotFoundException();
    }
    const supplied = parseBearer(authHeader);
    if (!supplied || !timingSafeEqual(supplied, token)) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing smoke debug token',
      });
    }
    const safeMarker = (marker ?? '').trim().slice(0, 200) || 'no-marker';
    this.sentry.captureSmokeError(
      safeMarker,
      new Error(`smoke debug deliberate error [${safeMarker}]`),
    );
    throw new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: 'smoke debug deliberate error',
    });
  }
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
