/**
 * TenantAwareDb is the only sanctioned way to read or write tenant data.
 *
 * Pattern: every request that touches tenant data calls `runInTenantContext`,
 * which:
 *   1. acquires a connection from the app_user pool
 *   2. BEGINs a transaction
 *   3. SET LOCAL app.current_tenant_id, app.current_user_id, request_id, ip, user_agent
 *   4. invokes the work function with a Drizzle handle bound to that tx
 *   5. COMMITs (or ROLLBACKs on throw)
 *   6. releases the connection back to the pool
 *
 * Because the GUCs use SET LOCAL, leaving the transaction returns the
 * connection to a clean state — no risk of leaking tenant context into the
 * next request that gets this connection.
 *
 * Routes that legitimately need to operate WITHOUT a tenant (signup, login)
 * use the public TransactionRunner.runAsAnonymous() helper instead. That path
 * still uses the app_user pool, so RLS still applies — anonymous queries see
 * zero rows for any tenant table, which is the desired behavior.
 */
import { Inject, Injectable } from '@nestjs/common';
import * as schema from '@ustowdispatch/db/schema';
import { sql } from 'drizzle-orm';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { APP_POOL } from './database.tokens.js';

export interface TenantContextValues {
  tenantId: string;
  userId: string;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export type Tx = NodePgDatabase<typeof schema> & { $client: PoolClient };

@Injectable()
export class TenantAwareDb {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async runInTenantContext<T>(
    ctx: TenantContextValues,
    work: (db: Tx, client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // set_config(name, value, is_local=true) is the parameterized form of SET LOCAL.
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [ctx.tenantId]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
      if (ctx.requestId) {
        await client.query("SELECT set_config('app.request_id', $1, true)", [ctx.requestId]);
      }
      if (ctx.ipAddress) {
        await client.query("SELECT set_config('app.request_ip', $1, true)", [ctx.ipAddress]);
      }
      if (ctx.userAgent) {
        await client.query("SELECT set_config('app.user_agent', $1, true)", [ctx.userAgent]);
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

  /**
   * Read-only escape hatch when you genuinely need a connection without a
   * tenant context (e.g. health checks, login lookup-by-email-and-slug). RLS
   * still applies; tenant tables will be invisible.
   */
  async runAnonymous<T>(work: (db: Tx, client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const db = drizzle(client, { schema, logger: false });
      const result = await work(db, client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cheap reachability ping for the readiness probe. */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql`SELECT 1`.toString());
    } finally {
      client.release();
    }
  }
}
