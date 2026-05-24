/**
 * dispatch_outcomes — the feedback loop (AI Smart Dispatch, Session 41).
 *
 * One row per actual dispatcher decision: the chosen truck/driver, whether it
 * was the engine's #1 recommendation, and (once known) the realised ETA vs the
 * predicted ETA. eta_error_minutes feeds ETA-accuracy reporting and the
 * per-tenant historical-bias correction; was_top_recommendation feeds
 * recommendation-accuracy reporting. This is the training data a future ML
 * model would consume — v1 only collects.
 *
 * recommendation_id is nullable: a dispatcher may assign before the engine ever
 * ran for the job. Defined in packages/db/sql/0045_ai_dispatch.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dispatchRecommendations } from './dispatch-recommendations';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { trucks } from './trucks';

export const dispatchOutcomes = pgTable(
  'dispatch_outcomes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => dispatchRecommendations.id, {
      onDelete: 'set null',
    }),
    chosenTruckId: uuid('chosen_truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'restrict' }),
    chosenDriverId: uuid('chosen_driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    wasTopRecommendation: boolean('was_top_recommendation').notNull().default(false),
    /** The ETA the engine predicted for the chosen candidate (minutes). */
    predictedEtaMinutes: integer('predicted_eta_minutes'),
    /** The ETA actually realised (minutes), filled when the job completes. */
    actualEtaMinutes: integer('actual_eta_minutes'),
    /** actual - predicted (minutes); + = arrived later than predicted. */
    etaErrorMinutes: integer('eta_error_minutes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('dispatch_outcomes_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
    tenantDriverIdx: index('dispatch_outcomes_tenant_driver_idx')
      .on(t.tenantId, t.chosenDriverId)
      .where(sql`deleted_at IS NULL`),
    tenantCreatedIdx: index('dispatch_outcomes_tenant_created_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DispatchOutcomeRow = typeof dispatchOutcomes.$inferSelect;
export type NewDispatchOutcomeRow = typeof dispatchOutcomes.$inferInsert;
