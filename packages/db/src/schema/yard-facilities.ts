/**
 * yard_facilities — physical facilities a tenant operates for the
 * operator-facing yard floor (Yard Management, Session 54).
 *
 * Distinct from S22 `impound_yards`: facilities own the stall map + rate
 * cards added this session, while impound_records continues to reference
 * impound_yards. Defined in packages/db/sql/0051_yard_management.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const yardFacilities = pgTable(
  'yard_facilities',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    address: jsonb('address').notNull().default({}),
    gateHours: jsonb('gate_hours').notNull().default({}),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('yard_facilities_tenant_active_idx')
      .on(t.tenantId, t.isActive)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type YardFacility = typeof yardFacilities.$inferSelect;
export type NewYardFacility = typeof yardFacilities.$inferInsert;
