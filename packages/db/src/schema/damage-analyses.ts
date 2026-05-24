/**
 * damage_analyses — one AI-vision analysis run over a set of evidence
 * photos for a job, in a given phase (Photo Damage Analysis, Session 42).
 *
 * photo_keys snapshots the evidence object keys handed to the provider so
 * the run is reproducible. The queue state machine (queued → processing →
 * complete | failed) is driven by the service inline and an env-gated
 * worker backstop that retries transient failures up to retry_count = 3.
 *
 * Defined in packages/db/sql/0041_damage_analysis.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const damageAnalysisPhaseValues = ['pre_tow', 'post_tow', 'claim_review'] as const;
export type DamageAnalysisPhase = (typeof damageAnalysisPhaseValues)[number];

export const damageAnalysisStatusValues = ['queued', 'processing', 'complete', 'failed'] as const;
export type DamageAnalysisStatus = (typeof damageAnalysisStatusValues)[number];

export const damageProviderValues = ['stub', 'anthropic', 'openai'] as const;
export type DamageProviderId = (typeof damageProviderValues)[number];

export const damageAnalyses = pgTable(
  'damage_analyses',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    phase: text('phase', { enum: damageAnalysisPhaseValues }).notNull(),
    photoKeys: text('photo_keys').array().notNull().default([]),
    vehicleContext: jsonb('vehicle_context'),
    provider: text('provider', { enum: damageProviderValues }).notNull(),
    model: text('model'),
    status: text('status', { enum: damageAnalysisStatusValues }).notNull().default('queued'),
    rawResponse: jsonb('raw_response'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('damage_analyses_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
    tenantJobPhaseIdx: index('damage_analyses_tenant_job_phase_idx')
      .on(t.tenantId, t.jobId, t.phase)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DamageAnalysis = typeof damageAnalyses.$inferSelect;
export type NewDamageAnalysis = typeof damageAnalyses.$inferInsert;
