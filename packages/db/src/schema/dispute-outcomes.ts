/**
 * dispute_outcomes — ground-truth feedback closing the loop (Fraud Detection,
 * Session 43).
 *
 * Once a dispute resolves, the operator records whether it was actually fraud
 * and (optionally) which signal predicted it. A future model-training session
 * reads these rows to tune signal weights. signal_id is nullable (a dispute
 * may resolve with no predictive signal) and ON DELETE SET NULL — historical
 * ground truth survives a soft-deleted/re-scored signal.
 *
 * Defined in packages/db/sql/0043_fraud_detection.sql.
 */
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { disputeRecords } from './dispute-records';
import { fraudRiskSignals } from './fraud-risk-signals';
import { tenants } from './tenants';
import { users } from './users';

export const disputeOutcomes = pgTable(
  'dispute_outcomes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputeRecords.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id').references(() => fraudRiskSignals.id, { onDelete: 'set null' }),
    wasFraud: boolean('was_fraud').notNull().default(false),
    groundTruthAt: timestamp('ground_truth_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDisputeIdx: index('dispute_outcomes_tenant_dispute_idx').on(t.tenantId, t.disputeId),
    tenantSignalIdx: index('dispute_outcomes_tenant_signal_idx').on(t.tenantId, t.signalId),
  }),
);

export type DisputeOutcome = typeof disputeOutcomes.$inferSelect;
export type NewDisputeOutcome = typeof disputeOutcomes.$inferInsert;
