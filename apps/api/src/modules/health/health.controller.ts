/**
 * /healthz   liveness probe — always 200 if the process can serve HTTP.
 * /readyz    readiness probe — checks db; returns 503 if it can't reach pg.
 *
 * These are the older aliases that pre-date the short /health + /ready
 * names. The canonical liveness/readiness probes (which also ping Redis)
 * live in HealthMetricsController (common/observability) and are what the
 * deploy pipeline + e2e harness hit; these aliases are kept for any
 * externally configured probe still pointing at the *z names.
 *
 * Both are public. We do NOT include build commit hash here; the deploy
 * pipeline injects that into the response via a wrapping reverse proxy if
 * needed.
 */
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

@Controller()
export class HealthController {
  constructor(private readonly db: TenantAwareDb) {}

  @Public()
  @Get('healthz')
  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('readyz')
  async readiness(): Promise<{ status: 'ok'; checks: { db: 'ok' } }> {
    try {
      await this.db.ping();
    } catch {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Database not reachable',
      });
    }
    return { status: 'ok', checks: { db: 'ok' } };
  }
}
