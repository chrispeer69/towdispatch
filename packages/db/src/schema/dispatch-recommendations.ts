/**
 * dispatch_recommendations — one persisted recommendation set per recompute
 * (AI Smart Dispatch, Session 41).
 *
 * The SmartDispatchService scores every eligible (truck, driver) candidate for
 * an unassigned job and writes the top-N here as a jsonb array. ADVISORY ONLY —
 * nothing in this table assigns a job; it is the input the dispatcher sees and
 * the anchor the feedback loop (dispatch_outcomes) measures against.
 *
 * recommendations jsonb is typed to RecommendationItem[] so reads are
 * strict-mode safe without casts. The canonical shape lives in
 * @ustowdispatch/shared (RecommendationItem); it is mirrored locally here
 * because the db package does not import shared types into its schema files
 * (same convention as lien-state-rules / rate-sheets — keeps tsc rootDir clean
 * and avoids a build-order coupling). Defined in
 * packages/db/sql/0045_ai_dispatch.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';

/**
 * Local mirror of @ustowdispatch/shared `RecommendationItem`. Keep in sync with
 * the shared contract — the wire/UI shape is owned there; this only types the
 * jsonb column.
 */
export interface RecommendationItemJson {
  truckId: string;
  truckUnit: string | null;
  driverId: string;
  driverName: string | null;
  shiftId: string | null;
  score: number;
  factors: Array<{
    key: string;
    score: number;
    weight: number;
    weightedContribution: number;
    detail: string;
  }>;
  predictedEtaMinutes: number | null;
}

export const dispatchRecommendations = pgTable(
  'dispatch_recommendations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    modelVersion: text('model_version').notNull(),
    recommendations: jsonb('recommendations')
      .$type<RecommendationItemJson[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Latest recommendation set for a job is read constantly (panel + outcomes).
    tenantJobComputedIdx: index('dispatch_recommendations_tenant_job_computed_idx')
      .on(t.tenantId, t.jobId, t.computedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DispatchRecommendationRow = typeof dispatchRecommendations.$inferSelect;
export type NewDispatchRecommendationRow = typeof dispatchRecommendations.$inferInsert;
