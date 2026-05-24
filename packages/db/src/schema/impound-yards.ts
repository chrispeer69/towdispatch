/**
 * impound_yards — the physical lots a tenant operates for vehicle
 * storage (Impound & Storage, Session 22).
 *
 * `code` is the short operator-facing label, unique per tenant among
 * live rows. `capacity` is advisory (NULL = untracked). Defined in
 * packages/db/sql/0036_impound_storage.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const impoundYards = pgTable(
  'impound_yards',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    capacity: integer('capacity'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('impound_yards_tenant_active_idx')
      .on(t.tenantId, t.isActive)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ImpoundYard = typeof impoundYards.$inferSelect;
export type NewImpoundYard = typeof impoundYards.$inferInsert;
