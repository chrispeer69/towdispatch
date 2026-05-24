/**
 * hd_truck_capabilities — per-truck heavy-duty equipment / rating detail
 * (Heavy-Duty Specialist, Session 36). One live row per truck; the
 * dispatch hot-path flag trucks.heavy_duty_capable is kept in sync by the
 * service layer. Defined in packages/db/sql/0039_heavy_duty.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const hdTruckCapabilities = pgTable(
  'hd_truck_capabilities',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'cascade' }),
    gvwrClass: integer('gvwr_class'),
    winchCapacityLbs: integer('winch_capacity_lbs'),
    boomCapacityLbs: integer('boom_capacity_lbs'),
    hasRotator: boolean('has_rotator').notNull().default(false),
    hasUnderLift: boolean('has_under_lift').notNull().default(false),
    hasAirCushions: boolean('has_air_cushions').notNull().default(false),
    axleCount: integer('axle_count'),
    maxRecoveryWeightLbs: integer('max_recovery_weight_lbs'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    truckUnique: uniqueIndex('hd_truck_capabilities_truck_unique')
      .on(t.truckId)
      .where(sql`deleted_at IS NULL`),
    tenantIdx: index('hd_truck_capabilities_tenant_idx')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type HdTruckCapability = typeof hdTruckCapabilities.$inferSelect;
export type NewHdTruckCapability = typeof hdTruckCapabilities.$inferInsert;
