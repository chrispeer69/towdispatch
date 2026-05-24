/**
 * impound_holds — legal holds on an impound record (Impound & Storage,
 * Session 22). A record may carry several holds at once; released_at IS
 * NULL means active, and any active hold blocks release in the service
 * layer. Defined in packages/db/sql/0036_impound_storage.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const impoundHoldTypeValues = ['police', 'abandoned', 'accident', 'owner_request'] as const;
export type ImpoundHoldType = (typeof impoundHoldTypeValues)[number];

export const impoundHolds = pgTable(
  'impound_holds',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundRecordId: uuid('impound_record_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'cascade' }),
    holdType: text('hold_type', { enum: impoundHoldTypeValues }).notNull(),
    authorityName: text('authority_name'),
    authorityReference: text('authority_reference'),
    reason: text('reason'),
    placedBy: uuid('placed_by').references(() => users.id, { onDelete: 'set null' }),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantRecordIdx: index('impound_holds_tenant_record_idx')
      .on(t.tenantId, t.impoundRecordId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ImpoundHold = typeof impoundHolds.$inferSelect;
export type NewImpoundHold = typeof impoundHolds.$inferInsert;
