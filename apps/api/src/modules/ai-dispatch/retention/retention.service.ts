/**
 * RetentionService — applies the two-phase ai-dispatch retention policy
 * (chore/ai-dispatch-retention).
 *
 * Layering:
 *   applyRetention(client, table, …)  — one table, inside an ALREADY-open
 *                                        transaction. HARD purge first, then
 *                                        SOFT mark (disjoint sets in a run).
 *                                        Batched so a sweep never holds a long
 *                                        lock; FOR UPDATE SKIP LOCKED so it
 *                                        never blocks live writers.
 *   runForTenant(ctx, …)              — all three tables for ONE tenant inside
 *                                        runInTenantContext, so RLS bounds
 *                                        every read/write to that tenant. Used
 *                                        by both the cron (per tenant) and the
 *                                        admin manual-trigger endpoint (caller's
 *                                        own tenant only).
 *   allTenantIds()                    — admin-pool discovery of live tenants
 *                                        (cron fan-out). Mirrors report-scheduler.
 *   statsForTenant(ctx)               — live/soft-deleted counts per table.
 *
 * Retention is the one sanctioned hard-delete path in the app (ARCHITECTURE
 * invariant #3 is "soft delete only" for CRUD — data-lifecycle purges are the
 * documented exception). Every purge is an `AFTER DELETE` row, so the
 * trigger-driven audit_log still captures it (invariant #2).
 *
 * Table names are interpolated into SQL — they come ONLY from the
 * RETENTION_POLICIES allowlist (never user input) and are asserted on entry.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ConfigService } from '../../../config/config.service.js';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import {
  RETENTION_POLICIES,
  RETENTION_TABLES,
  type RetentionTable,
  retentionCutoffs,
} from './retention-policy.js';

/** Audit actor for cron/admin-driven retention writes (mirrors report-scheduler). */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface RetentionCallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

export interface RetentionOptions {
  /** Clock for cutoff math. Defaults to now; overridable for tests. */
  now?: Date;
  /** Max rows mutated per statement before looping. Defaults to config. */
  batchSize?: number;
  /** When true, count what WOULD be affected and mutate nothing. */
  dryRun?: boolean;
}

export interface TableRetentionResult {
  table: RetentionTable;
  /** Rows acted on (softDeleted + hardDeleted) — or would-be acted on in dry-run. */
  scanned: number;
  softDeleted: number;
  hardDeleted: number;
  dryRun: boolean;
}

export interface TenantRetentionResult {
  tenantId: string;
  dryRun: boolean;
  tables: TableRetentionResult[];
}

export interface TableStatusCounts {
  table: RetentionTable;
  live: number;
  softDeleted: number;
}

@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  private assertTable(table: RetentionTable): void {
    if (!RETENTION_TABLES.includes(table)) {
      // Defence-in-depth: table is interpolated into SQL below.
      throw new Error(`RetentionService: unknown retention table "${table}"`);
    }
  }

  /**
   * Apply retention to one table inside an already-open transaction.
   * `client` is expected to carry the tenant RLS context (runInTenantContext)
   * for the cron/admin paths, so every statement is bounded to one tenant.
   */
  async applyRetention(
    client: PoolClient,
    table: RetentionTable,
    opts: RetentionOptions = {},
  ): Promise<TableRetentionResult> {
    this.assertTable(table);
    const policy = RETENTION_POLICIES[table];
    const now = opts.now ?? new Date();
    const batchSize = opts.batchSize ?? this.config.aiDispatch.retentionBatchSize;
    const dryRun = opts.dryRun ?? false;
    const { softCutoff, hardCutoff } = retentionCutoffs(policy, now);

    if (dryRun) {
      const hardDeleted = await this.countRows(
        client,
        `SELECT count(*)::int AS n FROM ${table} WHERE deleted_at IS NOT NULL AND created_at < $1`,
        hardCutoff,
      );
      const softDeleted = await this.countRows(
        client,
        `SELECT count(*)::int AS n FROM ${table} WHERE deleted_at IS NULL AND created_at < $1`,
        softCutoff,
      );
      return { table, scanned: softDeleted + hardDeleted, softDeleted, hardDeleted, dryRun: true };
    }

    // HARD first: purge already-soft-deleted rows past the hard cutoff. Doing
    // this before the SOFT pass keeps the two sets disjoint, so a live row past
    // the hard age is soft-deleted now and purged on the NEXT run (grace).
    const hardDeleted = await this.runBatched(
      client,
      `WITH victims AS (
         SELECT id FROM ${table}
          WHERE deleted_at IS NOT NULL AND created_at < $1
          ORDER BY created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} t USING victims v WHERE t.id = v.id`,
      hardCutoff,
      batchSize,
    );

    const softDeleted = await this.runBatched(
      client,
      `WITH victims AS (
         SELECT id FROM ${table}
          WHERE deleted_at IS NULL AND created_at < $1
          ORDER BY created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} t SET deleted_at = now() FROM victims v WHERE t.id = v.id`,
      softCutoff,
      batchSize,
    );

    return { table, scanned: softDeleted + hardDeleted, softDeleted, hardDeleted, dryRun: false };
  }

  /** Run all retention tables for ONE tenant, RLS-bounded. */
  async runForTenant(
    ctx: RetentionCallerCtx,
    opts: RetentionOptions = {},
  ): Promise<TenantRetentionResult> {
    const dryRun = opts.dryRun ?? false;
    const tables = await this.db.runInTenantContext({ ...ctx }, async (_db, client) => {
      const results: TableRetentionResult[] = [];
      for (const table of RETENTION_TABLES) {
        results.push(await this.applyRetention(client, table, opts));
      }
      return results;
    });
    return { tenantId: ctx.tenantId, dryRun, tables };
  }

  /** System-actor variant for the cron fan-out (one tenant at a time). */
  async runForTenantAsSystem(
    tenantId: string,
    opts: RetentionOptions = {},
  ): Promise<TenantRetentionResult> {
    const now = opts.now ?? new Date();
    return this.runForTenant(
      { tenantId, userId: SYSTEM_USER_ID, requestId: `ai-dispatch-retention-${now.getTime()}` },
      opts,
    );
  }

  /** Live tenant ids via the admin pool (RLS-exempt discovery). */
  async allTenantIds(): Promise<string[]> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const res = await client.query<{ id: string }>(
        'SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id',
      );
      return res.rows.map((r) => r.id);
    });
  }

  /** Live / soft-deleted counts per table for the caller's tenant. */
  async statsForTenant(ctx: RetentionCallerCtx): Promise<TableStatusCounts[]> {
    return this.db.runInTenantContext({ ...ctx }, async (_db, client) => {
      const out: TableStatusCounts[] = [];
      for (const table of RETENTION_TABLES) {
        this.assertTable(table);
        const res = await client.query<{ live: string; soft_deleted: string }>(
          `SELECT
             count(*) FILTER (WHERE deleted_at IS NULL)     AS live,
             count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
           FROM ${table}`,
        );
        const row = res.rows[0];
        out.push({
          table,
          live: Number(row?.live ?? 0),
          softDeleted: Number(row?.soft_deleted ?? 0),
        });
      }
      return out;
    });
  }

  private async countRows(client: PoolClient, sql: string, cutoff: Date): Promise<number> {
    const res = await client.query<{ n: number }>(sql, [cutoff]);
    return res.rows[0]?.n ?? 0;
  }

  /** Run a LIMIT-bounded mutation repeatedly until a partial batch returns. */
  private async runBatched(
    client: PoolClient,
    sql: string,
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const res = await client.query(sql, [cutoff, batchSize]);
      const n = res.rowCount ?? 0;
      total += n;
      if (n < batchSize) break;
    }
    return total;
  }
}
