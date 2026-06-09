/**
 * Connection factory.
 *
 * Two pools by design:
 *   - app_user pool: used by the runtime API. Cannot bypass RLS.
 *   - app_admin pool: used by migrations, seeds, and ops tooling. Bypasses RLS.
 *
 * We use node-postgres (pg) rather than the postgres.js driver because
 * NestJS + drizzle-orm has a more mature integration with pg, and pg's pool
 * is what most Postgres ops tooling targets.
 */
import pg from 'pg';
import type { PoolConfig } from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

export type DbPool = pg.Pool;
export type AppDb = ReturnType<typeof createDrizzle>;

export const createAppPool = (overrides: Partial<PoolConfig> = {}): pg.Pool => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for the runtime app pool');
  }
  return new Pool({
    connectionString: url,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'towdispatch-api',
    ...overrides,
  });
};

export const createAdminPool = (overrides: Partial<PoolConfig> = {}): pg.Pool => {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set');
  }
  return new Pool({
    connectionString: url,
    max: Number.parseInt(process.env.DATABASE_ADMIN_POOL_MAX ?? '4', 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'towdispatch-admin',
    ...overrides,
  });
};

export const createDrizzle = (pool: pg.Pool) => drizzle(pool, { schema, logger: false });

const trackedPools: pg.Pool[] = [];
export const trackPool = <T extends pg.Pool>(pool: T): T => {
  trackedPools.push(pool);
  return pool;
};

export const closeAllPools = async (): Promise<void> => {
  await Promise.all(trackedPools.splice(0).map((p) => p.end()));
};
