/**
 * driver_shifts — one row per (driver, truck) on-shift session.
 *
 * Identical to the Session 5 shape: drivers move in and out of shifts daily;
 * the row is created when a driver clocks on and `endedAt` is stamped when
 * they clock off. Session 8 leaves this table alone; it's referenced by the
 * fleet UI for "current driver of truck X" / "current truck of driver Y" but
 * the dispatch module is the only writer for status and GPS columns.
 *
 * Active-shift uniqueness is enforced by partial unique indexes in 0010 SQL.
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
    lastPositionAt: timestamp('last_position_at', { withTimezone: true }),

    /**
     * Scheduled vs actual: scheduled_*at for upcoming shifts (future Session
     * extends shift planning); started_at / ended_at for actuals. Both
     * scheduled fields nullable today since the session-5 path was clock-on
     * driven only.
     */
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    notes: text('notes'),

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
