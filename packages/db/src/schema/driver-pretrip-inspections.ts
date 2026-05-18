/**
 * driver_pretrip_inspections — DVIR submitted from the in-truck app.
 *
 * Distinct from the dispatcher-facing `dvirs` table (Session 8). This
 * one is shaped around the truck-app's three-state status + opinionated
 * item checklist + signature-pad capture. The two tables coexist for
 * Session 1 of the driver build; consolidation is a later call.
 *
 * status values:
 *   pass         — every item ok
 *   fail_safe    — defects, but truck is safe to roll
 *   fail_unsafe  — defects make the truck unsafe; service layer must
 *                  flip trucks.status to in_maintenance
 *
 * items shape (validated at the Zod layer):
 *   [{ key, label, state: 'ok'|'attention'|'fail', note?, photo_keys?[] }, ...]
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { driverShifts } from './driver-shifts';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const driverPretripInspectionStatusValues = ['pass', 'fail_safe', 'fail_unsafe'] as const;
export type DriverPretripInspectionStatus = (typeof driverPretripInspectionStatusValues)[number];

export const driverPretripInspections = pgTable(
  'driver_pretrip_inspections',
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
    shiftId: uuid('shift_id').references(() => driverShifts.id, { onDelete: 'set null' }),
    status: text('status', { enum: driverPretripInspectionStatusValues }).notNull(),
    items: jsonb('items').notNull().default([]),
    odometerMiles: bigint('odometer_miles', { mode: 'number' }),
    signatureDataUrl: text('signature_data_url'),
    notes: text('notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantDriverSubmittedIdx: index('dpi_tenant_driver_submitted_idx').on(
      t.tenantId,
      t.driverId,
      t.submittedAt,
    ),
    tenantTruckSubmittedIdx: index('dpi_tenant_truck_submitted_idx').on(
      t.tenantId,
      t.truckId,
      t.submittedAt,
    ),
    tenantShiftIdx: index('dpi_tenant_shift_idx').on(t.tenantId, t.shiftId),
    tenantStatusSubmittedIdx: index('dpi_tenant_status_submitted_idx').on(
      t.tenantId,
      t.status,
      t.submittedAt,
    ),
  }),
);

export type DriverPretripInspection = typeof driverPretripInspections.$inferSelect;
export type NewDriverPretripInspection = typeof driverPretripInspections.$inferInsert;
