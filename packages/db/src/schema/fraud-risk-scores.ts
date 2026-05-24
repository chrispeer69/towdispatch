/**
 * fraud_risk_scores — composite fraud/dispute risk score per job (Fraud
 * Detection, Session 43).
 *
 * job_id IS the primary key: exactly one score per job. Re-scoring is
 * ON CONFLICT (job_id) DO UPDATE. top_signals snapshots the highest-weight
 * contributing signals (type + severity + points) so the risk-detail UI can
 * render a breakdown without re-joining the signals table. reviewed_* tracks
 * the explicit operator decision (mark-reviewed / hold-invoice / escalate /
 * cleared) — the module never auto-acts.
 *
 * Defined in packages/db/sql/0043_fraud_detection.sql.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FraudSeverity, FraudSignalType } from './fraud-risk-signals';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const fraudRiskBandValues = ['low', 'medium', 'high', 'critical'] as const;
export type FraudRiskBand = (typeof fraudRiskBandValues)[number];

export const fraudReviewActionValues = ['reviewed', 'hold_invoice', 'escalate', 'cleared'] as const;
export type FraudReviewAction = (typeof fraudReviewActionValues)[number];

/** Snapshot of a contributing signal stored on the score's top_signals jsonb. */
export interface FraudScoreTopSignal {
  signalType: FraudSignalType;
  severity: FraudSeverity;
  points: number;
}

export const fraudRiskScores = pgTable(
  'fraud_risk_scores',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    score0100: integer('score_0_100').notNull().default(0),
    riskBand: text('risk_band', { enum: fraudRiskBandValues }).notNull().default('low'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    topSignals: jsonb('top_signals').$type<FraudScoreTopSignal[]>().notNull().default([]),
    modelVersion: text('model_version').notNull().default('fraud-v1.0'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewAction: text('review_action', { enum: fraudReviewActionValues }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantBandIdx: index('fraud_risk_scores_tenant_band_idx').on(
      t.tenantId,
      t.riskBand,
      t.computedAt,
    ),
  }),
);

export type FraudRiskScore = typeof fraudRiskScores.$inferSelect;
export type NewFraudRiskScore = typeof fraudRiskScores.$inferInsert;
