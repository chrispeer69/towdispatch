/**
 * Migration runner.
 *
 * Order of operations:
 *   1. Apply Drizzle-generated SQL migrations (./drizzle/) — creates tables.
 *   2. Apply raw SQL files in ./sql/ in lexicographic order — extensions,
 *      roles, RLS policies, audit triggers. These cannot be expressed in
 *      Drizzle's TypeScript schema today.
 *
 * State tracking:
 *   A `_applied_migrations` table records which SQL files have already been
 *   applied. On each run, only new (unapplied) files are executed. This
 *   prevents re-running migrations that aren't fully idempotent and avoids
 *   "column does not exist" errors from partial schema state.
 *
 * Connects with DATABASE_ADMIN_URL (the bootstrap superuser) because RLS
 * setup, role creation, and trigger ownership all require ownership privileges
 * that the runtime app_user role intentionally lacks.
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DRIZZLE_DIR = join(ROOT, 'drizzle');
const SQL_DIR = join(ROOT, 'sql');

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required to run migrations');
}

const log = (msg: string): void => {
  process.stdout.write(`[migrate] ${msg}\n`);
};

/**
 * Ensure the migration tracking table exists and return the set of
 * already-applied filenames.
 */
async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _applied_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum TEXT
      );
    `);
    const result = await client.query('SELECT filename FROM _applied_migrations ORDER BY filename');
    return new Set(result.rows.map((r: { filename: string }) => r.filename));
  } finally {
    client.release();
  }
}

/**
 * Record a migration as applied.
 */
async function recordMigration(client: pg.PoolClient, filename: string): Promise<void> {
  await client.query(
    'INSERT INTO _applied_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename],
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 4 });

  // Pass GUCs that 0002_roles.sql reads to materialize role passwords.
  const appUserPw = process.env.APP_USER_PASSWORD ?? 'app_user_dev_pw';
  const appAdminPw = process.env.APP_ADMIN_PASSWORD ?? 'app_admin_dev_pw';

  try {
    // 1. Drizzle migrations (has its own tracking via __drizzle_migrations table)
    if (existsSync(DRIZZLE_DIR)) {
      log('applying Drizzle migrations from ./drizzle');
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder: DRIZZLE_DIR });
      log('Drizzle migrations applied');
    } else {
      log('no ./drizzle folder yet — skipping Drizzle migrations');
    }

    // 2. Raw SQL migrations with state tracking
    if (existsSync(SQL_DIR)) {
      const applied = await getAppliedMigrations(pool);
      const files = readdirSync(SQL_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      let appliedCount = 0;
      let skippedCount = 0;

      for (const file of files) {
        if (applied.has(file)) {
          skippedCount++;
          continue;
        }

        log(`applying ${file}`);
        const sql = readFileSync(join(SQL_DIR, file), 'utf8');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `SET LOCAL app.app_user_password = '${appUserPw.replace(/'/g, "''")}'`,
          );
          await client.query(
            `SET LOCAL app.app_admin_password = '${appAdminPw.replace(/'/g, "''")}'`,
          );
          await client.query(sql);
          await recordMigration(client, file);
          await client.query('COMMIT');
          appliedCount++;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }

      log(
        `done — ${appliedCount} applied, ${skippedCount} skipped (already applied)`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[migrate] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
