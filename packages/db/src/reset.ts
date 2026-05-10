/**
 * Dev-only database reset. DROPs the public schema and recreates it.
 * Refuses to run if NODE_ENV === 'production'.
 */
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('[reset] refusing to run in production\n');
  process.exit(2);
}

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    process.stdout.write('[reset] dropping and recreating public schema\n');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
    // Drop drizzle's bookkeeping schema too. Without this, the next
    // `migrate` run sees the old __drizzle_migrations rows, thinks every
    // migration has already been applied, and silently skips them — yet
    // FK references try to resolve against a now-empty public schema and
    // fail with "relation tenants does not exist". Dropping forces a
    // clean re-apply of the entire chain.
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    process.stdout.write('[reset] done\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[reset] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
