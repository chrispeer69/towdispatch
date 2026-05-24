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
import { ConfigService } from '../config/config.service.js';
import { selectPoolToken } from './connection.js';
import { APP_POOL, REPLICA_POOL } from './database.tokens.js';

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
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    @Inject(REPLICA_POOL) private readonly replicaPool: Pool,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve the pool a unit of work should run against. The decision rule
   * (`selectPoolToken`) is pure and unit-tested; here we just map the token to
   * the injected instance. Default is always the primary — see connection.ts.
   */
  private pickPool(readonly: boolean): Pool {
    const token = selectPoolToken({
      readonly,
      replicaConfigured: this.config.readReplicaConfigured,
    });
    return token === REPLICA_POOL ? this.replicaPool : this.pool;
  }

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

  /**
   * Read-only tenant work, routed to the read replica when one is configured
   * (otherwise the primary). The transaction is opened READ ONLY so a stray
   * write fails loud rather than silently hitting a replica. RLS still applies:
   * the same SET LOCAL tenant GUCs are set, and the replica enforces the same
   * policies as the primary. Callers MUST guarantee the work issues no writes —
   * this is an explicit opt-in, never the default (see connection.ts).
   */
  async runReadOnly<T>(
    ctx: TenantContextValues,
    work: (db: Tx, client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pickPool(true).connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [ctx.tenantId]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
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

  /** Cheap reachability ping for the readiness probe. */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql`SELECT 1`.toString());
    } finally {
      client.release();
    }
  }

  /**
   * Best-effort replication lag in seconds, measured against the read replica.
   * Returns null when no distinct replica is configured (single region), when
   * the replica is actually the primary, or when the monitoring function is
   * not grantable to app_user (needs pg_monitor — documented in the runbook).
   * Never throws: the readiness probe must not fail because lag is unknowable.
   */
  async replicaLagSeconds(): Promise<number | null> {
    if (!this.config.readReplicaConfigured) return null;
    const client = await this.replicaPool.connect();
    try {
      const res = await client.query<{ lag: number | null }>(
        'SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float8 AS lag',
      );
      const lag = res.rows[0]?.lag ?? null;
      return lag === null ? null : Math.max(0, lag);
    } catch {
      return null;
    } finally {
      client.release();
    }
  }
}
