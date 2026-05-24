/**
 * api_keys — tenant-scoped credentials for the Public REST API (Session 29).
 *
 * The full key crosses the wire exactly once, at creation, in the form
 * `tc_live_<prefix>_<secret>`. We persist only:
 *   - `prefix`  : the public, indexed lookup id (also shown in the UI list)
 *   - `keyHash` : SHA-256 of the full key string (high-entropy random token,
 *                 so a fast hash is correct — a per-request argon2/bcrypt
 *                 would be a DoS vector and buys nothing against a 256-bit
 *                 random secret). Never store or log the raw key.
 *
 * `createdBy` is NOT NULL: a key is always minted by an authenticated
 * operator, and that user becomes the audit actor for every write made with
 * the key (app.current_user_id is set to it inside the tenant transaction).
 *
 * Defined in packages/db/sql/0037_public_api.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
    rateLimitPerMin: integer('rate_limit_per_min').notNull().default(60),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    prefixUnique: index('api_keys_prefix_unique').on(t.prefix).where(sql`deleted_at IS NULL`),
    tenantIdx: index('api_keys_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
