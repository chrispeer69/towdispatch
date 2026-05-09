/**
 * Migration runner.
 *
 * Order of operations:
 *   1. Apply Drizzle-generated SQL migrations (./drizzle/) — creates tables.
 *   2. Apply raw SQL files in ./sql/ in lexicographic order — extensions,
 *      roles, RLS policies, audit triggers. These cannot be expressed in
 *      Drizzle's TypeScript schema today.
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

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 4 });

  // Pass GUCs that 0002_roles.sql reads to materialize role passwords.
  const appUserPw = process.env.APP_USER_PASSWORD ?? 'app_user_dev_pw';
  const appAdminPw = process.env.APP_ADMIN_PASSWORD ?? 'app_admin_dev_pw';

  try {
    if (existsSync(DRIZZLE_DIR)) {
      log('applying Drizzle migrations from ./drizzle');
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder: DRIZZLE_DIR });
      log('Drizzle migrations applied');
    } else {
      log('no ./drizzle folder yet — skipping Drizzle migrations');
    }

    if (existsSync(SQL_DIR)) {
      const files = readdirSync(SQL_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
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
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }
    }

    log('done');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[migrate] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
