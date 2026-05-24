/**
 * fraud_risk_signals — one row per detected anomaly on a job (Fraud
 * Detection, Session 43).
 *
 * signal_type names the pure detector that fired; severity + confidence_pct
 * describe how strong the hit is; payload carries detector-specific evidence
 * (the duplicate job id, the mileage ratio, the status-flip count, …).
 * model_version stamps the detector revision so a future trained model can
 * coexist with v1 heuristics.
 *
 * Re-scoring is an upsert: a job carries at most one live signal of a given
 * signal_type (partial unique index in the migration). Defined in
 * packages/db/sql/0043_fraud_detection.sql.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';

export const fraudSignalTypeValues = [
  'duplicate_invoice',
  'excessive_mileage',
  'rapid_resequencing',
  'off_hours_dispatch',
  'missing_evidence',
  'driver_anomaly',
  'cash_only_pattern',
  'geofence_violation',
  'bill_to_storage_acceleration',
] as const;
export type FraudSignalType = (typeof fraudSignalTypeValues)[number];

export const fraudSeverityValues = ['info', 'low', 'medium', 'high'] as const;
export type FraudSeverity = (typeof fraudSeverityValues)[number];

export const fraudRiskSignals = pgTable(
  'fraud_risk_signals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    signalType: text('signal_type', { enum: fraudSignalTypeValues }).notNull(),
    severity: text('severity', { enum: fraudSeverityValues }).notNull().default('info'),
    confidencePct: integer('confidence_pct').notNull().default(0),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    modelVersion: text('model_version').notNull().default('fraud-v1.0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    jobTypeUnique: uniqueIndex('fraud_risk_signals_job_type_unique')
      .on(t.jobId, t.signalType)
      .where(sql`deleted_at IS NULL`),
    tenantJobIdx: index('fraud_risk_signals_tenant_job_idx')
      .on(t.tenantId, t.jobId)
      .where(sql`deleted_at IS NULL`),
    tenantTypeIdx: index('fraud_risk_signals_tenant_type_idx')
      .on(t.tenantId, t.signalType, t.detectedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type FraudRiskSignal = typeof fraudRiskSignals.$inferSelect;
export type NewFraudRiskSignal = typeof fraudRiskSignals.$inferInsert;
