/**
 * impound_records — one row per vehicle taken into storage (Impound &
 * Storage, Session 22).
 *
 * job_id / vehicle_id link the originating tow + a known vehicle when
 * present; both are nullable because most impounds are for vehicles not
 * in the tenant's book, so the make/model/VIN are snapshotted on the
 * row. The storage clock (storage_started_at, accrued_fee_cents,
 * last_accrued_on) is maintained by the daily accrual cron.
 *
 * Defined in packages/db/sql/0036_impound_storage.sql.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { impoundYards } from './impound-yards';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';
import { vehicles } from './vehicles';

export const impoundRecordStatusValues = [
  'stored',
  'pending_release',
  'released',
  'transferred',
  'disposed',
] as const;
export type ImpoundRecordStatus = (typeof impoundRecordStatusValues)[number];

export const impoundRecords = pgTable(
  'impound_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    yardId: uuid('yard_id')
      .notNull()
      .references(() => impoundYards.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    vehicleMake: text('vehicle_make'),
    vehicleModel: text('vehicle_model'),
    vehicleYear: integer('vehicle_year'),
    vehicleColor: text('vehicle_color'),
    vehicleVin: text('vehicle_vin'),
    licensePlate: text('license_plate'),
    licenseState: text('license_state'),
    status: text('status', { enum: impoundRecordStatusValues }).notNull().default('stored'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }).notNull().defaultNow(),
    storageStartedAt: timestamp('storage_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    dailyFeeCents: integer('daily_fee_cents').notNull().default(0),
    intakeMileage: integer('intake_mileage'),
    intakePhotoKeys: text('intake_photo_keys').array().notNull().default([]),
    conditionNotes: text('condition_notes'),
    lienEligible: boolean('lien_eligible').notNull().default(false),
    lienEligibleAt: timestamp('lien_eligible_at', { withTimezone: true }),
    accruedFeeCents: bigint('accrued_fee_cents', { mode: 'number' }).notNull().default(0),
    lastAccruedOn: date('last_accrued_on'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('impound_records_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantYardIdx: index('impound_records_tenant_yard_idx')
      .on(t.tenantId, t.yardId)
      .where(sql`deleted_at IS NULL`),
    tenantLienIdx: index('impound_records_tenant_lien_idx')
      .on(t.tenantId, t.lienEligible)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ImpoundRecord = typeof impoundRecords.$inferSelect;
export type NewImpoundRecord = typeof impoundRecords.$inferInsert;
