/**
 * yard_stalls — one stall on a facility's floor (Yard Management,
 * Session 54). (x, y) are grid coordinates the web map renders; row/col
 * are optional human labels. occupied_by_impound_id points at the S22
 * impound_records row parked here (NULL = empty). Defined in
 * packages/db/sql/0051_yard_management.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { yardFacilities } from './yard-facilities';

export const yardStallTypeValues = [
  'standard',
  'oversized',
  'covered',
  'secure',
  'hazmat',
  'ev',
] as const;
export type YardStallType = (typeof yardStallTypeValues)[number];

export const yardStalls = pgTable(
  'yard_stalls',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => yardFacilities.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    rowLabel: text('row_label'),
    colLabel: text('col_label'),
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    stallType: text('stall_type', { enum: yardStallTypeValues }).notNull().default('standard'),
    occupiedByImpoundId: uuid('occupied_by_impound_id').references(() => impoundRecords.id, {
      onDelete: 'set null',
    }),
    occupiedSince: timestamp('occupied_since', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantFacilityIdx: index('yard_stalls_tenant_facility_idx')
      .on(t.tenantId, t.facilityId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type YardStall = typeof yardStalls.$inferSelect;
export type NewYardStall = typeof yardStalls.$inferInsert;
