/**
 * Unit spec — AiDispatchRetentionCron. RetentionService + SentryService are
 * stubbed; no DB. Verifies the env gate, the per-tenant fan-out aggregation,
 * resilience to one bad tenant, and the per-run breadcrumb.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentryService } from '../../../common/observability/sentry.service.js';
import type { ConfigService } from '../../../config/config.service.js';
import { AiDispatchRetentionCron } from './retention.cron.js';
import type { RetentionService, TenantRetentionResult } from './retention.service.js';

function configWith(retentionCronEnabled: boolean): ConfigService {
  return { aiDispatch: { retentionCronEnabled } } as unknown as ConfigService;
}

function tenantResult(tenantId: string, soft: number, hard: number): TenantRetentionResult {
  return {
    tenantId,
    dryRun: false,
    tables: [
      {
        table: 'dispatch_recommendations',
        scanned: soft + hard,
        softDeleted: soft,
        hardDeleted: hard,
        dryRun: false,
      },
    ],
  };
}

describe('AiDispatchRetentionCron', () => {
  let sentry: { addBreadcrumb: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sentry = { addBreadcrumb: vi.fn() };
  });

  it('cronTick short-circuits when the env flag is disabled', async () => {
    const retention = { allTenantIds: vi.fn(), runForTenantAsSystem: vi.fn() };
    const cron = new AiDispatchRetentionCron(
      retention as unknown as RetentionService,
      configWith(false),
      sentry as unknown as SentryService,
    );
    expect(await cron.cronTick()).toBeNull();
    expect(retention.allTenantIds).not.toHaveBeenCalled();
  });

  it('sweeps every tenant and aggregates soft/hard counts + breadcrumb', async () => {
    const retention = {
      allTenantIds: vi.fn(async () => ['t1', 't2']),
      runForTenantAsSystem: vi.fn(async (id: string) =>
        id === 't1' ? tenantResult('t1', 2, 1) : tenantResult('t2', 3, 4),
      ),
    };
    const cron = new AiDispatchRetentionCron(
      retention as unknown as RetentionService,
      configWith(true),
      sentry as unknown as SentryService,
    );
    const res = await cron.tick(new Date('2026-05-24T03:00:00Z'));
    expect(res).toMatchObject({ tenants: 2, tenantsFailed: 0, softDeleted: 5, hardDeleted: 5 });
    expect(retention.runForTenantAsSystem).toHaveBeenCalledTimes(2);
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      'ai-dispatch.retention',
      'retention sweep complete',
      expect.objectContaining({ tenants: 2, softDeleted: 5, hardDeleted: 5 }),
    );
  });

  it('one failing tenant is counted and skipped, the sweep continues', async () => {
    const retention = {
      allTenantIds: vi.fn(async () => ['ok1', 'bad', 'ok2']),
      runForTenantAsSystem: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('boom');
        return tenantResult(id, 1, 0);
      }),
    };
    const cron = new AiDispatchRetentionCron(
      retention as unknown as RetentionService,
      configWith(true),
      sentry as unknown as SentryService,
    );
    const res = await cron.tick();
    expect(res).toMatchObject({ tenants: 3, tenantsFailed: 1, softDeleted: 2, hardDeleted: 0 });
  });
});
