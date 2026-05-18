/**
 * driver_telemetry_events — high-frequency GPS / status pings.
 *
 * Append-only by policy. No audit trigger — at 1–5 Hz across 100k
 * drivers this would crater audit_log. The table itself IS the
 * movement audit trail.
 *
 * event_kind disambiguates regular pings from semantic transitions
 * (shift_start, status_change, geofence_*). New kinds are added as a
 * migration to the CHECK list — keeping it as text avoids ALTER TYPE
 * on a hot table.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { driverShifts } from './driver-shifts';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';

export const driverTelemetryEventKindValues = [
  'ping',
  'shift_start',
  'shift_end',
  'status_change',
  'geofence_enter',
  'geofence_exit',
  'low_battery',
  'manual',
] as const;
export type DriverTelemetryEventKind = (typeof driverTelemetryEventKindValues)[number];

export const driverTelemetryEvents = pgTable(
  'driver_telemetry_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id').references(() => driverShifts.id, { onDelete: 'set null' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** numeric(9,6) — stored as string by drizzle to avoid float drift. */
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    speedMph: numeric('speed_mph', { precision: 6, scale: 2 }),
    headingDegrees: numeric('heading_degrees', { precision: 5, scale: 2 }),
    accuracyMeters: numeric('accuracy_meters', { precision: 8, scale: 2 }),
    batteryPct: integer('battery_pct'),
    eventKind: text('event_kind', { enum: driverTelemetryEventKindValues })
      .notNull()
      .default('ping'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantDriverRecordedIdx: index('dte_tenant_driver_recorded_idx').on(
      t.tenantId,
      t.driverId,
      t.recordedAt,
    ),
    tenantShiftRecordedIdx: index('dte_tenant_shift_recorded_idx').on(
      t.tenantId,
      t.shiftId,
      t.recordedAt,
    ),
    tenantJobRecordedIdx: index('dte_tenant_job_recorded_idx').on(
      t.tenantId,
      t.jobId,
      t.recordedAt,
    ),
    tenantEventKindIdx: index('dte_tenant_event_kind_idx').on(
      t.tenantId,
      t.eventKind,
      t.recordedAt,
    ),
  }),
);

export type DriverTelemetryEvent = typeof driverTelemetryEvents.$inferSelect;
export type NewDriverTelemetryEvent = typeof driverTelemetryEvents.$inferInsert;
