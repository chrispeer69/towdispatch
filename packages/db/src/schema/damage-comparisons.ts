/**
 * damage_comparisons — a pre-vs-post damage comparison for a job (Photo
 * Damage Analysis, Session 42).
 *
 * new_damage_findings is the JSON array of damage present post-tow that
 * was absent (or less severe) pre-tow — the evidentiary core of a
 * fraud-claim defense. confidence_threshold records the fraction (0..1,
 * default 0.65) used so the result is reproducible. One live comparison
 * per (job, pre, post) triple.
 *
 * Defined in packages/db/sql/0041_damage_analysis.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { damageAnalyses } from './damage-analyses';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const damageComparisons = pgTable(
  'damage_comparisons',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    preAnalysisId: uuid('pre_analysis_id')
      .notNull()
      .references(() => damageAnalyses.id, { onDelete: 'restrict' }),
    postAnalysisId: uuid('post_analysis_id')
      .notNull()
      .references(() => damageAnalyses.id, { onDelete: 'restrict' }),
    newDamageFindings: jsonb('new_damage_findings').notNull().default([]),
    comparisonSummary: text('comparison_summary'),
    confidenceThreshold: numeric('confidence_threshold', { precision: 4, scale: 3 })
      .notNull()
      .default('0.650'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJobIdx: index('damage_comparisons_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DamageComparison = typeof damageComparisons.$inferSelect;
export type NewDamageComparison = typeof damageComparisons.$inferInsert;
