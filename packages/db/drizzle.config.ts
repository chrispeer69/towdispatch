/**
 * Drizzle Kit configuration.
 * Migrations point at DATABASE_ADMIN_URL — schema mutations require ownership
 * privileges that the runtime app_user role intentionally does not have.
 */
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL (or DATABASE_URL) must be set for drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: adminUrl,
  },
  strict: true,
  verbose: true,
});
