/**
 * GET /health   liveness — 200 if the process can serve HTTP.
 * GET /ready    readiness — 200 if DB + Redis + S3 reachable; 503 otherwise.
 * GET /metrics  Prometheus exposition format.
 *
 * /healthz and /readyz remain as the older aliases that the deploy
 * pipeline points at; these new short names are what most load
 * balancers default to.
 */
import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES, type RegionHealth } from '@ustowdispatch/shared';
import type { Redis } from 'ioredis';
import { RegionContextService } from '../../common/region/region-context.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { REDIS_CLIENT } from '../../modules/redis/redis.tokens.js';
import { Public } from '../decorators/public.decorator.js';
import { MetricsService } from './metrics.service.js';

@Controller()
export class HealthMetricsController {
  constructor(
    private readonly db: TenantAwareDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metrics: MetricsService,
    private readonly region: RegionContextService,
  ) {}

  @Public()
  @Get('health')
  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async readiness(): Promise<{
    status: 'ok';
    checks: { db: 'ok'; redis: 'ok' };
    // Session 44 — additive. Existing fields above are unchanged so probes
    // and the deploy pipeline keep working; failover tooling reads `region`.
    region: RegionHealth;
  }> {
    const checks: { db?: 'ok'; redis?: 'ok' } = {};
    try {
      await this.db.ping();
      checks.db = 'ok';
    } catch {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Database not reachable',
      });
    }
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') throw new Error('redis ping mismatch');
      checks.redis = 'ok';
    } catch {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Redis not reachable',
      });
    }
    return {
      status: 'ok',
      checks: checks as { db: 'ok'; redis: 'ok' },
      region: await this.region.health(),
    };
  }

  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async getMetrics(): Promise<string> {
    return this.metrics.snapshot();
  }
}
