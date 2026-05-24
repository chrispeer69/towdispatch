/**
 * eta_predictions — every predictive-ETA computation (AI Smart Dispatch,
 * Session 41).
 *
 * Append-style log of what the ETA engine projected for a job, with the inputs
 * (origin/dest, time-of-day, day-of-week) and the model version. Kept so we can
 * (a) compare against the realised ETA in dispatch_outcomes and (b) retrain a
 * future model on real (features → outcome) pairs. lat/lng are numeric(9,6),
 * returned as strings by drizzle (house convention; service maps at the DTO
 * boundary). Defined in packages/db/sql/0045_ai_dispatch.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';

export const etaPredictions = pgTable(
  'eta_predictions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    predictedAt: timestamp('predicted_at', { withTimezone: true }).notNull().defaultNow(),
    originLat: numeric('origin_lat', { precision: 9, scale: 6 }),
    originLng: numeric('origin_lng', { precision: 9, scale: 6 }),
    destLat: numeric('dest_lat', { precision: 9, scale: 6 }),
    destLng: numeric('dest_lng', { precision: 9, scale: 6 }),
    /** Hour-of-day 0..23 (local) the prediction was anchored to. */
    timeOfDay: integer('time_of_day').notNull(),
    /** Day-of-week 0=Sun..6=Sat. */
    dayOfWeek: integer('day_of_week').notNull(),
    predictedMinutes: integer('predicted_minutes').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('eta_predictions_tenant_job_idx')
      .on(t.tenantId, t.jobId, t.predictedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type EtaPredictionRow = typeof etaPredictions.$inferSelect;
export type NewEtaPredictionRow = typeof etaPredictions.$inferInsert;
