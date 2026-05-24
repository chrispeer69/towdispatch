import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';

/**
 * Customer Self-Serve Portal session (Session 55). Account-less, scoped to a
 * single impound + verified identity. `lookupToken` is the browser handle;
 * `magicLinkToken` is the one-time link exchanged for the session cookie.
 * Tables in packages/db/sql/0051_self_serve_portal.sql.
 */
export const customerPortalSessions = pgTable(
  'customer_portal_sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundId: uuid('impound_id').references(() => impoundRecords.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    lookupToken: text('lookup_token').notNull(),
    magicLinkToken: text('magic_link_token'),
    magicLinkExpiresAt: timestamp('magic_link_expires_at', { withTimezone: true }),
    claims: jsonb('claims').notNull().default(sql`'{}'::jsonb`),
    ip: text('ip'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantLookupUnique: uniqueIndex('customer_portal_sessions_tenant_lookup_unique')
      .on(t.tenantId, t.lookupToken)
      .where(sql`deleted_at IS NULL`),
    magicLinkUnique: uniqueIndex('customer_portal_sessions_magic_link_unique')
      .on(t.magicLinkToken)
      .where(sql`magic_link_token IS NOT NULL AND deleted_at IS NULL`),
    tenantImpoundIdx: index('customer_portal_sessions_tenant_impound_idx')
      .on(t.tenantId, t.impoundId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type CustomerPortalSession = typeof customerPortalSessions.$inferSelect;
export type NewCustomerPortalSession = typeof customerPortalSessions.$inferInsert;
