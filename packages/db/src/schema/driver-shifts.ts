/**
 * driver_shifts — one row per (driver, truck) on-shift session. Drivers move
 * in and out of shifts daily; the row is created when a driver clocks on and
 * `endedAt` is stamped when they clock off. While a shift is active, the
 * row carries last-known GPS position and the driver's current operational
 * status (available / en_route / on_scene / in_progress / returning / break).
 *
 * One driver can only have one active shift at a time — partial unique index
 * (tenant_id, driver_id) WHERE ended_at IS NULL AND deleted_at IS NULL
 * enforced in 0009. Same goes for a truck: one truck can only be tied to
 * one active shift.
 *
 * GPS columns are text-encoded decimals (matching jobs.pickupLat/Lng) so
 * the schema travels cleanly across PostGIS-on/off environments. The
 * driver app (Session 6) will report position via REST every 30s on an
 * active job, 120s otherwise.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const driverShiftStatusValues = [
  'available',
  'en_route',
  'on_scene',
  'in_progress',
  'returning',
  'break',
] as const;
export type DriverShiftStatus = (typeof driverShiftStatusValues)[number];

export const driverShifts = pgTable(
  'driver_shifts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    truckId: uuid('truck_id').references(() => trucks.id, { onDelete: 'set null' }),

    status: text('status', { enum: driverShiftStatusValues }).notNull().default('available'),

    /** Currently-assigned job (if any). Null when between jobs. */
    currentJobId: uuid('current_job_id'),

    lastLat: text('last_lat'),
    lastLng: text('last_lng'),
    /** When the last GPS ping landed. NULL = never reported. */
    lastPositionAt: timestamp('last_position_at', { withTimezone: true }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantDriverIdx: index('driver_shifts_tenant_driver_idx').on(t.tenantId, t.driverId),
    tenantTruckIdx: index('driver_shifts_tenant_truck_idx').on(t.tenantId, t.truckId),
    tenantActiveIdx: index('driver_shifts_tenant_ended_idx').on(t.tenantId, t.endedAt),
    tenantStatusIdx: index('driver_shifts_tenant_status_idx').on(t.tenantId, t.status),
    tenantCurrentJobIdx: index('driver_shifts_tenant_current_job_idx').on(
      t.tenantId,
      t.currentJobId,
    ),
  }),
);

export type DriverShift = typeof driverShifts.$inferSelect;
export type NewDriverShift = typeof driverShifts.$inferInsert;
