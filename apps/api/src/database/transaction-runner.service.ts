/**
 * Admin-pool transaction runner. Uses ADMIN_POOL (bootstrap superuser).
 * RLS does not apply to the table owner, so this is the path used for:
 *   - tenant creation during signup
 *   - cross-tenant ops tooling
 *   - migration and seed scripts at runtime
 *
 * Every call sets app.current_user_id where known so the audit trigger still
 * captures the actor.
 */
import { Inject, Injectable } from '@nestjs/common';
import * as schema from '@towdispatch/db/schema';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { ADMIN_POOL } from './database.tokens.js';

export interface AdminContext {
  actorUserId?: string | undefined;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export type AdminTx = NodePgDatabase<typeof schema> & { $client: PoolClient };

@Injectable()
export class TransactionRunner {
  constructor(@Inject(ADMIN_POOL) private readonly pool: Pool) {}

  async runAsAdmin<T>(
    ctx: AdminContext,
    work: (db: AdminTx, client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (ctx.actorUserId) {
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.actorUserId]);
      }
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
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
