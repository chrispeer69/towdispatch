/**
 * Unit spec — RetentionService. No real DB: the PoolClient is stubbed.
 *
 * Covers:
 *   - applyRetention boundary cases (no rows / all old / mixed) + batching loop
 *   - dry-run counts and mutates nothing
 *   - HARD phase runs before SOFT phase (the two-phase invariant)
 *   - RLS isolation: every tenant runs in its OWN runInTenantContext
 *   - full soft → hard cycle via time-travel against an in-memory fake table
 */
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../../../config/config.service.js';
import type { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import type { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { RETENTION_POLICIES, retentionCutoffs } from './retention-policy.js';
import { RetentionService } from './retention.service.js';

const MS_PER_DAY = 86_400_000;
const now = new Date('2026-05-24T03:00:00Z');

function configWith(batchSize: number): ConfigService {
  return { aiDispatch: { retentionBatchSize: batchSize } } as unknown as ConfigService;
}

function makeService(args: {
  batchSize?: number;
  db?: unknown;
  admin?: unknown;
}): RetentionService {
  return new RetentionService(
    (args.db ?? {}) as TenantAwareDb,
    (args.admin ?? {}) as TransactionRunner,
    configWith(args.batchSize ?? 500),
  );
}

/** Stub client that answers by inspecting the SQL it receives. */
function makeStubClient(opts: {
  hardBatches?: number[];
  softBatches?: number[];
  countHard?: number;
  countSoft?: number;
}): { client: PoolClient; calls: string[] } {
  const hard = [...(opts.hardBatches ?? [0])];
  const soft = [...(opts.softBatches ?? [0])];
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('count(*)')) {
      calls.push('count');
      const n = sql.includes('IS NOT NULL') ? (opts.countHard ?? 0) : (opts.countSoft ?? 0);
      return { rows: [{ n }], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM')) {
      calls.push('hard');
      return { rowCount: hard.shift() ?? 0, rows: [] };
    }
    calls.push('soft');
    return { rowCount: soft.shift() ?? 0, rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

describe('RetentionService.applyRetention', () => {
  it('no rows → zero counts, one hard + one soft statement', async () => {
    const svc = makeService({});
    const { client, calls } = makeStubClient({ hardBatches: [0], softBatches: [0] });
    const res = await svc.applyRetention(client, 'dispatch_recommendations', {
      now,
      batchSize: 100,
    });
    expect(res).toMatchObject({ scanned: 0, softDeleted: 0, hardDeleted: 0, dryRun: false });
    expect(calls).toEqual(['hard', 'soft']);
  });

  it('mixed → sums hard and soft', async () => {
    const svc = makeService({});
    const { client } = makeStubClient({ hardBatches: [4], softBatches: [7] });
    const res = await svc.applyRetention(client, 'eta_predictions', { now, batchSize: 100 });
    expect(res).toMatchObject({ hardDeleted: 4, softDeleted: 7, scanned: 11 });
  });

  it('runs the HARD phase before the SOFT phase', async () => {
    const svc = makeService({});
    const { client, calls } = makeStubClient({ hardBatches: [1], softBatches: [1] });
    await svc.applyRetention(client, 'dispatch_outcomes', { now, batchSize: 100 });
    expect(calls.indexOf('hard')).toBeLessThan(calls.indexOf('soft'));
  });

  it('all-old → loops each phase until a partial batch', async () => {
    const svc = makeService({});
    // batchSize 2: hard returns 2,2,1 (stop) = 5; soft returns 2,1 (stop) = 3.
    const { client, calls } = makeStubClient({ hardBatches: [2, 2, 1], softBatches: [2, 1] });
    const res = await svc.applyRetention(client, 'dispatch_recommendations', {
      now,
      batchSize: 2,
    });
    expect(res).toMatchObject({ hardDeleted: 5, softDeleted: 3, scanned: 8 });
    expect(calls.filter((c) => c === 'hard')).toHaveLength(3);
    expect(calls.filter((c) => c === 'soft')).toHaveLength(2);
  });

  it('dry-run counts only, mutates nothing', async () => {
    const svc = makeService({});
    const { client, calls } = makeStubClient({ countHard: 9, countSoft: 4 });
    const res = await svc.applyRetention(client, 'eta_predictions', {
      now,
      batchSize: 100,
      dryRun: true,
    });
    expect(res).toMatchObject({ hardDeleted: 9, softDeleted: 4, scanned: 13, dryRun: true });
    expect(calls).toEqual(['count', 'count']);
    expect(calls).not.toContain('hard');
    expect(calls).not.toContain('soft');
  });

  it('passes the policy cutoffs as statement params', async () => {
    const svc = makeService({});
    const queryCalls: Array<[string, unknown[]]> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queryCalls.push([sql, params]);
        return { rowCount: 0, rows: [] };
      }),
    } as unknown as PoolClient;
    await svc.applyRetention(client, 'dispatch_recommendations', { now, batchSize: 100 });
    const { softCutoff, hardCutoff } = retentionCutoffs(
      RETENTION_POLICIES.dispatch_recommendations,
      now,
    );
    // NB: the hard DELETE also contains "FOR UPDATE", so match the soft phase
    // on its distinctive "SET deleted_at" clause.
    const hardCall = queryCalls.find(([sql]) => sql.includes('DELETE FROM'));
    const softCall = queryCalls.find(([sql]) => sql.includes('SET deleted_at'));
    expect(hardCall?.[1]).toEqual([hardCutoff, 100]);
    expect(softCall?.[1]).toEqual([softCutoff, 100]);
  });

  it('rejects an unknown table before issuing SQL', async () => {
    const svc = makeService({});
    const { client } = makeStubClient({});
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      svc.applyRetention(client, 'jobs' as any, { now }),
    ).rejects.toThrow(/unknown retention table/);
  });
});

describe('RetentionService.runForTenant — RLS isolation', () => {
  it('runs every tenant inside its own tenant context with the system actor', async () => {
    const seen: Array<{ tenantId: string; userId: string }> = [];
    const db = {
      runInTenantContext: vi.fn(
        async (
          ctx: { tenantId: string; userId: string },
          work: (db: unknown, client: PoolClient) => Promise<unknown>,
        ) => {
          seen.push({ tenantId: ctx.tenantId, userId: ctx.userId });
          const { client } = makeStubClient({ hardBatches: [0], softBatches: [0] });
          return work({}, client);
        },
      ),
    };
    const svc = makeService({ db });

    await svc.runForTenantAsSystem('tenant-A', { now });
    await svc.runForTenantAsSystem('tenant-B', { now });

    expect(seen.map((s) => s.tenantId)).toEqual(['tenant-A', 'tenant-B']);
    expect(seen.every((s) => s.userId === '00000000-0000-0000-0000-000000000000')).toBe(true);
    // Three tables swept per tenant.
    const res = await svc.runForTenantAsSystem('tenant-C', { now });
    expect(res.tables).toHaveLength(3);
  });
});

describe('RetentionService.allTenantIds', () => {
  it('discovers live tenants via the admin pool', async () => {
    const admin = {
      runAsAdmin: vi.fn(
        async (_ctx: unknown, work: (db: unknown, client: PoolClient) => unknown) => {
          const client = {
            query: vi.fn(async () => ({ rows: [{ id: 't1' }, { id: 't2' }], rowCount: 2 })),
          } as unknown as PoolClient;
          return work({}, client);
        },
      ),
    };
    const svc = makeService({ admin });
    expect(await svc.allTenantIds()).toEqual(['t1', 't2']);
  });
});

describe('RetentionService.statsForTenant', () => {
  it('returns coerced live / soft-deleted counts for each table, one query per table', async () => {
    const queries: string[] = [];
    const db = {
      runInTenantContext: vi.fn(
        async (
          _ctx: { tenantId: string },
          work: (db: unknown, client: PoolClient) => Promise<unknown>,
        ) => {
          const client = {
            query: vi.fn(async (sql: string) => {
              queries.push(sql);
              return { rows: [{ live: '5', soft_deleted: '2' }], rowCount: 1 };
            }),
          } as unknown as PoolClient;
          return work({}, client);
        },
      ),
    };
    const svc = makeService({ db });
    const stats = await svc.statsForTenant({ tenantId: 't1', userId: 'u1', requestId: 'r1' });
    expect(stats).toEqual([
      { table: 'dispatch_recommendations', live: 5, softDeleted: 2 },
      { table: 'dispatch_outcomes', live: 5, softDeleted: 2 },
      { table: 'eta_predictions', live: 5, softDeleted: 2 },
    ]);
    expect(queries).toHaveLength(3);
    expect(queries.every((q) => q.includes('count(*) FILTER'))).toBe(true);
  });
});

/**
 * Full soft → hard cycle against an in-memory fake table. The fake interprets
 * the two retention statements directly (NOT via the classifier), so it is an
 * independent check that the SQL predicates + run-order produce the lifecycle.
 */
describe('RetentionService — soft → hard cycle (time-travel)', () => {
  interface Row {
    id: string;
    createdAt: Date;
    deletedAt: Date | null;
  }

  function fakeTableClient(rows: Row[]): PoolClient {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      const cutoff = params[0] as Date;
      const limit = params[1] as number;
      if (sql.includes('DELETE FROM')) {
        const victims = rows
          .filter((r) => r.deletedAt !== null && r.createdAt.getTime() < cutoff.getTime())
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, limit);
        for (const v of victims) rows.splice(rows.indexOf(v), 1);
        return { rowCount: victims.length, rows: [] };
      }
      // UPDATE ... soft
      const victims = rows
        .filter((r) => r.deletedAt === null && r.createdAt.getTime() < cutoff.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
      for (const v of victims) v.deletedAt = new Date();
      return { rowCount: victims.length, rows: [] };
    });
    return { query } as unknown as PoolClient;
  }

  it('a row past the soft age is soft-deleted on run 1, then purged on a later run', async () => {
    const svc = makeService({});
    // dispatch_recommendations: soft 30 / hard 60.
    const row: { id: string; createdAt: Date; deletedAt: Date | null } = {
      id: 'r1',
      createdAt: new Date(now.getTime() - 40 * MS_PER_DAY), // 40d old → past soft, before hard
      deletedAt: null,
    };
    const rows = [row];
    const client = fakeTableClient(rows);

    // Run 1 at `now`: soft-delete only (40d < hard 60d → not yet purged).
    const r1 = await svc.applyRetention(client, 'dispatch_recommendations', {
      now,
      batchSize: 100,
    });
    expect(r1).toMatchObject({ softDeleted: 1, hardDeleted: 0 });
    expect(rows[0]?.deletedAt).not.toBeNull();

    // Run 2, 25 days later: the row is now 65d old AND soft-deleted → purged.
    const later = new Date(now.getTime() + 25 * MS_PER_DAY);
    const r2 = await svc.applyRetention(client, 'dispatch_recommendations', {
      now: later,
      batchSize: 100,
    });
    expect(r2).toMatchObject({ softDeleted: 0, hardDeleted: 1 });
    expect(rows).toHaveLength(0);
  });

  it('a fresh row is untouched', async () => {
    const svc = makeService({});
    const rows = [{ id: 'r1', createdAt: new Date(now.getTime() - MS_PER_DAY), deletedAt: null }];
    const client = fakeTableClient(rows);
    const res = await svc.applyRetention(client, 'dispatch_recommendations', {
      now,
      batchSize: 100,
    });
    expect(res).toMatchObject({ softDeleted: 0, hardDeleted: 0 });
    expect(rows[0]?.deletedAt).toBeNull();
  });
});
