/**
 * Unit coverage for the liveness/readiness probes (Phase 0 hardening,
 * Session 17). Locks in: liveness is always 200; readiness is 200 only when
 * BOTH Postgres and Redis answer; and readiness throws 503 when either
 * dependency is unreachable (mocked). The 503 path is what the deploy probe
 * (scripts/deploy.sh) and orchestrator health checks rely on.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { RegionContextService } from '../../common/region/region-context.service.js';
import type { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { RegionContextService } from '../region/region-context.service.js';
import { HealthMetricsController } from './health-metrics.controller.js';
import type { MetricsService } from './metrics.service.js';

// Multi-Region (S44): readiness reports region health via RegionContextService.
const stubRegion = {
  health: () =>
    Promise.resolve({
      regionId: 'us-east',
      role: 'primary',
      isPrimary: true,
      replicaLagSeconds: null,
      peer: null,
    }),
} as unknown as RegionContextService;

function build(opts: {
  dbOk?: boolean;
  redisOk?: boolean;
}): HealthMetricsController {
  const db = {
    ping: vi.fn(() =>
      opts.dbOk === false ? Promise.reject(new Error('db down')) : Promise.resolve(),
    ),
  } as unknown as TenantAwareDb;
  const redis = {
    ping: vi.fn(() =>
      opts.redisOk === false ? Promise.reject(new Error('redis down')) : Promise.resolve('PONG'),
    ),
  } as unknown as Redis;
  const metrics = {
    snapshot: vi.fn(() => Promise.resolve('# metrics')),
  } as unknown as MetricsService;
  return new HealthMetricsController(db, redis, metrics, stubRegion);
  return new HealthMetricsController(db, redis, metrics, {} as unknown as RegionContextService);
  const region = {
    health: vi.fn(() => Promise.resolve({ id: 'test-region', role: 'primary', isPrimary: true })),
  } as unknown as RegionContextService;
  return new HealthMetricsController(db, redis, metrics, region);
}

describe('HealthMetricsController', () => {
  it('liveness returns ok with a non-negative uptime', () => {
    const res = build({}).liveness();
    expect(res.status).toBe('ok');
    expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness returns ok when db and redis both answer', async () => {
    const res = await build({ dbOk: true, redisOk: true }).readiness();
    expect(res).toMatchObject({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
    expect(res.status).toBe('ok');
    expect(res.checks).toEqual({ db: 'ok', redis: 'ok' });
    // Session 44 added an additive `region` field; assert it is surfaced.
    expect(res.region).toBeDefined();
  });

  it('readiness throws 503 when the database is unreachable', async () => {
    await expect(build({ dbOk: false, redisOk: true }).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('readiness throws 503 when redis is unreachable', async () => {
    await expect(build({ dbOk: true, redisOk: false }).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('readiness throws 503 when redis answers with an unexpected reply', async () => {
    const redis = { ping: vi.fn(() => Promise.resolve('NOPE')) } as unknown as Redis;
    const db = { ping: vi.fn(() => Promise.resolve()) } as unknown as TenantAwareDb;
    const metrics = { snapshot: vi.fn() } as unknown as MetricsService;
    const controller = new HealthMetricsController(db, redis, metrics, stubRegion);
    const controller = new HealthMetricsController(
      db,
      redis,
      metrics,
      {} as unknown as RegionContextService,
    );
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('metrics returns the snapshot string', async () => {
    const out = await build({}).getMetrics();
    expect(out).toBe('# metrics');
  });
});
