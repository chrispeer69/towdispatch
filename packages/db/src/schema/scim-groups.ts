/**
 * scim_groups — SCIM 2.0 Group mirror (Session 38). externalId is the
 * IdP-assigned id (re-POST idempotency anchor); displayName is unique per
 * tenant among live rows.
 *
 * Defined in packages/db/sql/0048_enterprise_sso.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ssoConnections } from './sso-connections';
import { tenants } from './tenants';

export const scimGroups = pgTable(
  'scim_groups',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id').references(() => ssoConnections.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('scim_groups_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
  }),
);

export type ScimGroup = typeof scimGroups.$inferSelect;
export type NewScimGroup = typeof scimGroups.$inferInsert;
