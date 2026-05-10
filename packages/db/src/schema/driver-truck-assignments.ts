/**
 * driver_truck_assignments — many-to-many between drivers and trucks.
 *
 * "Driver A is qualified to operate truck B." Different from driver_shifts:
 * a shift is the active session, while an assignment expresses long-running
 * qualification / preference. The fleet UI uses this to populate the
 * "Assigned trucks" pill on the driver profile and "Assigned drivers" on
 * the truck profile.
 *
 * Soft-deleted, audited, FORCE RLS. Uniqueness on (tenant_id, driver_id,
 * truck_id) WHERE deleted_at IS NULL is a partial index in 0011 SQL.
 */
import { boolean, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const driverTruckAssignments = pgTable(
  'driver_truck_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'restrict' }),

    /** True when this is the driver's go-to truck (one per driver, soft-enforced). */
    isPrimary: boolean('is_primary').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantDriverIdx: index('driver_truck_assignments_tenant_driver_idx').on(t.tenantId, t.driverId),
    tenantTruckIdx: index('driver_truck_assignments_tenant_truck_idx').on(t.tenantId, t.truckId),
  }),
);

export type DriverTruckAssignment = typeof driverTruckAssignments.$inferSelect;
export type NewDriverTruckAssignment = typeof driverTruckAssignments.$inferInsert;
