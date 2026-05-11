/**
 * ReportingReadService — a tenant-scoped read-only handle for the report
 * queries.
 *
 * Decision (documented in docs/reporting.md):
 *   - We tag the connection with application_name='reporting' so it can be
 *     moved to a Postgres read-replica without code changes when the replica
 *     is provisioned. Until then it reuses the same APP_POOL as the primary.
 *   - Every report runs inside a `SET LOCAL` transaction so RLS still
 *     applies, identical to TenantAwareDb. The only difference is that we
 *     commit the empty transaction at the end — reports never write.
 */
import { Inject, Injectable } from '@nestjs/common';
import * as schema from '@towcommand/db/schema';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { APP_POOL } from '../../database/database.tokens.js';

export type ReportTx = NodePgDatabase<typeof schema> & { $client: PoolClient };

export interface ReportContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  role: string | null;
}

@Injectable()
export class ReportingReadService {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * Run a read-only function inside a transaction with the tenant GUC set.
   * Tagged `application_name='reporting'` for replica routing later.
   */
  async run<T>(ctx: ReportContext, work: (db: ReportTx, client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [ctx.tenantId]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
      await client.query("SELECT set_config('application_name', 'reporting', true)");
      if (ctx.requestId) {
        await client.query("SELECT set_config('app.request_id', $1, true)", [ctx.requestId]);
      }
      const db = drizzle(client, { schema, logger: false });
      const result = await work(db, client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // already rolled back / connection broken
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
