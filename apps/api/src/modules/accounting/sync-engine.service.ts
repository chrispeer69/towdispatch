/**
 * SyncEngineService — owns the lifecycle of every sync_jobs row.
 *
 * Concurrency model:
 *   - Enqueue is idempotent: a partial unique index on (tenant_id, provider,
 *     entity_type, entity_id, direction) WHERE status IN ('pending','processing')
 *     means INSERT … ON CONFLICT DO NOTHING is a safe no-op when a job is
 *     already in flight. Once the job terminates a fresh row is allowed.
 *   - Claim is atomic: UPDATE … SET status='processing' WHERE id IN
 *     (SELECT … FOR UPDATE SKIP LOCKED) lets multiple workers / API
 *     instances safely share the table without claiming the same row twice.
 *
 * Retry / backoff:
 *   - On failure: status → 'failed', retry_count += 1, next_attempt_at set to
 *     `now + 2^attempt seconds` (capped at 1h), last_error captured.
 *   - After 5 failed attempts the row moves to 'dead_letter' for operator
 *     triage. retrySync() resets a dead-letter row to pending.
 *
 * Why DB-backed (not Redis): the same Postgres tx that writes the invoice can
 * enqueue its sync job, so the two are committed together — no chance of an
 * invoice landing without its sync record (or vice versa). The cost is a
 * polling worker; we trade ~1s latency for transactional safety.
 *
 * Test integration: processBatch() is the unit of work the worker performs.
 * Tests call it directly to drive the engine deterministically — no setInterval
 * race conditions.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type SyncJob, syncJobs, uuidv7 } from '@towcommand/db';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import type {
  AccountingProvider,
  AccountingProviderCredentials,
} from '../../integrations/accounting/accounting-provider.interface.js';
import { ACCOUNTING_PROVIDER } from './accounting.tokens.js';

export const MAX_RETRY_COUNT = 5;
const MAX_BACKOFF_SECONDS = 3600;

export type SyncJobHandler = (
  job: SyncJob,
  provider: AccountingProvider,
  creds: AccountingProviderCredentials,
) => Promise<{ externalId?: string | null }>;

@Injectable()
export class SyncEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<string, SyncJobHandler>();
  private credsResolver:
    | ((tenantId: string) => Promise<AccountingProviderCredentials | null>)
    | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly admin: TransactionRunner,
    config: ConfigService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {
    this.logger = config.logger.child({ component: 'sync-engine' });
  }

  /**
   * Set by AccountingService at bootstrap. We keep the dependency one-way
   * (engine → service via callback) to avoid circular DI; the engine does not
   * need to know the service's full surface.
   */
  configure(opts: {
    handlers: Record<string, SyncJobHandler>;
    credsResolver: (tenantId: string) => Promise<AccountingProviderCredentials | null>;
  }): void {
    for (const [key, h] of Object.entries(opts.handlers)) {
      this.handlers.set(key, h);
    }
    this.credsResolver = opts.credsResolver;
  }

  onModuleInit(): void {
    // Production / dev: every 5 seconds, drain a small batch. Tests opt out
    // by setting NODE_ENV=test so processBatch() can be called explicitly.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.processBatch(10).catch((err) => {
        this.logger.warn({ err: String(err) }, 'processBatch failed');
      });
    }, 5_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Enqueue a sync job. If a non-terminal job already exists for the same
   * entity+direction, the insert no-ops and we return null.
   */
  async enqueue(
    tenantId: string,
    args: {
      entityType: 'customer' | 'invoice' | 'payment' | 'refund';
      entityId: string;
      direction: 'push' | 'pull';
      payload?: Record<string, unknown>;
    },
  ): Promise<string | null> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const id = uuidv7();
      const r = await client.query<{ id: string }>(
        `INSERT INTO sync_jobs (
           id, tenant_id, provider, entity_type, entity_id, direction,
           status, retry_count, next_attempt_at, payload, created_at, updated_at
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, 'pending', 0,
                 now(), $7::jsonb, now(), now())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          id,
          tenantId,
          this.provider.descriptor.id,
          args.entityType,
          args.entityId,
          args.direction,
          args.payload ? JSON.stringify(args.payload) : null,
        ],
      );
      return r.rows[0]?.id ?? null;
    });
  }

  /**
   * Drain up to `limit` ready jobs. Returns counts so tests can assert work
   * actually happened.
   */
  async processBatch(
    limit = 10,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!this.credsResolver) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    const claimed = await this.claimReadyJobs(limit);
    let succeeded = 0;
    let failed = 0;
    for (const job of claimed) {
      try {
        const creds = await this.credsResolver(job.tenantId);
        if (!creds) {
          await this.markFailed(job, 'no active accounting connection');
          failed += 1;
          continue;
        }
        const handlerKey = `${job.direction}.${job.entityType}`;
        const handler = this.handlers.get(handlerKey);
        if (!handler) {
          await this.markFailed(job, `no handler for ${handlerKey}`);
          failed += 1;
          continue;
        }
        const result = await handler(job, this.provider, creds);
        await this.markCompleted(job, result.externalId ?? null);
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.markFailed(job, message);
        failed += 1;
      }
    }
    return { processed: claimed.length, succeeded, failed };
  }

  /**
   * Per-tenant variant — used by tests that want to drain only a single
   * tenant's queue (so a noisy neighbor in the same test DB does not affect
   * the assertion).
   */
  async processBatchForTenant(
    tenantId: string,
    limit = 10,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!this.credsResolver) return { processed: 0, succeeded: 0, failed: 0 };
    const claimed = await this.claimReadyJobs(limit, tenantId);
    let succeeded = 0;
    let failed = 0;
    for (const job of claimed) {
      try {
        const creds = await this.credsResolver(job.tenantId);
        if (!creds) {
          await this.markFailed(job, 'no active accounting connection');
          failed += 1;
          continue;
        }
        const handlerKey = `${job.direction}.${job.entityType}`;
        const handler = this.handlers.get(handlerKey);
        if (!handler) {
          await this.markFailed(job, `no handler for ${handlerKey}`);
          failed += 1;
          continue;
        }
        const result = await handler(job, this.provider, creds);
        await this.markCompleted(job, result.externalId ?? null);
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.markFailed(job, message);
        failed += 1;
      }
    }
    return { processed: claimed.length, succeeded, failed };
  }

  /**
   * Reset a dead-letter or failed job back to pending so the next batch
   * picks it up. Returns the affected job id, or null if no row matched.
   */
  async retrySync(
    tenantId: string,
    entityType: 'customer' | 'invoice' | 'payment' | 'refund',
    entityId: string,
  ): Promise<string | null> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ id: string }>(
        `UPDATE sync_jobs
            SET status = 'pending',
                retry_count = 0,
                next_attempt_at = now(),
                last_error = NULL,
                updated_at = now()
          WHERE tenant_id = $1::uuid
            AND provider = $2
            AND entity_type = $3
            AND entity_id = $4::uuid
            AND status IN ('failed', 'dead_letter')
          RETURNING id`,
        [tenantId, this.provider.descriptor.id, entityType, entityId],
      );
      return r.rows[0]?.id ?? null;
    });
  }

  async getSyncStatusFor(
    tenantId: string,
    entityType: 'customer' | 'invoice' | 'payment' | 'refund',
    entityId: string,
  ): Promise<SyncJob | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.syncJobs.findFirst({
        where: and(
          eq(syncJobs.tenantId, tenantId),
          eq(syncJobs.entityType, entityType),
          eq(syncJobs.entityId, entityId),
        ),
        orderBy: (j, { desc }) => desc(j.createdAt),
      });
      return row ?? null;
    });
  }

  async listRecent(tenantId: string, limit = 50): Promise<SyncJob[]> {
    return this.admin.runAsAdmin({}, async (db) =>
      db.query.syncJobs.findMany({
        where: eq(syncJobs.tenantId, tenantId),
        orderBy: (j, { desc }) => desc(j.createdAt),
        limit,
      }),
    );
  }

  async countsByStatus(tenantId: string): Promise<Record<string, number>> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n
           FROM sync_jobs
          WHERE tenant_id = $1::uuid
          GROUP BY status`,
        [tenantId],
      );
      const out: Record<string, number> = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        dead_letter: 0,
      };
      for (const row of r.rows) {
        out[row.status] = row.n;
      }
      return out;
    });
  }

  // ===== internals =====

  private async claimReadyJobs(limit: number, tenantId?: string): Promise<SyncJob[]> {
    return this.admin.runAsAdmin({}, async (db, client) => {
      // SELECT … FOR UPDATE SKIP LOCKED is the safe atomic claim in pg.
      const params: unknown[] = [limit];
      let whereClause = `status = 'pending' AND next_attempt_at <= now()`;
      if (tenantId) {
        params.push(tenantId);
        whereClause += ` AND tenant_id = $${params.length}::uuid`;
      }
      const claimed = await client.query<{ id: string }>(
        `WITH ready AS (
           SELECT id FROM sync_jobs
            WHERE ${whereClause}
            ORDER BY next_attempt_at
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE sync_jobs s
            SET status = 'processing',
                last_attempt_at = now(),
                updated_at = now()
           FROM ready
          WHERE s.id = ready.id
          RETURNING s.id`,
        params,
      );
      if (claimed.rows.length === 0) return [];
      const ids = claimed.rows.map((r) => r.id);
      const rowsRes = await client.query<{
        id: string;
        tenant_id: string;
        provider: string;
        entity_type: string;
        entity_id: string;
        direction: string;
        status: string;
        external_id: string | null;
        retry_count: number;
        next_attempt_at: Date;
        last_attempt_at: Date | null;
        last_error: string | null;
        payload: unknown;
        created_at: Date;
        updated_at: Date;
        completed_at: Date | null;
      }>('SELECT * FROM sync_jobs WHERE id = ANY($1::uuid[])', [ids]);
      // Preserve claim order
      const order = new Map(ids.map((id, idx) => [id, idx]));
      const jobs: SyncJob[] = rowsRes.rows
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((r) => ({
          id: r.id,
          tenantId: r.tenant_id,
          provider: r.provider as SyncJob['provider'],
          entityType: r.entity_type as SyncJob['entityType'],
          entityId: r.entity_id,
          direction: r.direction as SyncJob['direction'],
          status: r.status as SyncJob['status'],
          externalId: r.external_id,
          retryCount: r.retry_count,
          nextAttemptAt: r.next_attempt_at,
          lastAttemptAt: r.last_attempt_at,
          lastError: r.last_error,
          payload: r.payload,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          completedAt: r.completed_at,
        }));
      return jobs;
    });
  }

  private async markCompleted(job: SyncJob, externalId: string | null): Promise<void> {
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE sync_jobs
            SET status = 'completed',
                external_id = COALESCE($2, external_id),
                completed_at = now(),
                updated_at = now()
          WHERE id = $1::uuid`,
        [job.id, externalId],
      );
    });
  }

  private async markFailed(job: SyncJob, error: string): Promise<void> {
    const newAttempt = job.retryCount + 1;
    const goingDead = newAttempt >= MAX_RETRY_COUNT;
    const status = goingDead ? 'dead_letter' : 'failed';
    const backoffSeconds = Math.min(2 ** newAttempt, MAX_BACKOFF_SECONDS);
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE sync_jobs
            SET status = $2,
                retry_count = $3,
                last_error = $4,
                next_attempt_at = now() + ($5::int || ' seconds')::interval,
                updated_at = now()
          WHERE id = $1::uuid`,
        [job.id, status, newAttempt, error.slice(0, 4000), backoffSeconds],
      );
    });
    // Promote 'failed' rows to 'pending' immediately so processBatch() picks
    // them up on the next tick, respecting next_attempt_at. Tests rely on
    // failed rows being re-tried by the next call to processBatch() so we
    // bump them back to 'pending'. The active-entity uniqueness still holds
    // (pending and processing are the two non-terminal states).
    if (!goingDead) {
      await this.admin.runAsAdmin({}, async (_db, client) => {
        await client.query(
          `UPDATE sync_jobs SET status = 'pending', updated_at = now()
            WHERE id = $1::uuid AND status = 'failed'`,
          [job.id],
        );
      });
    }
  }
}
