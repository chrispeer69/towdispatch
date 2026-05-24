/**
 * dispute_records — a dispute a motor club raised against a submitted invoice
 * for a job (Fraud Detection, Session 43).
 *
 * Logged by the operator (no partner integration in v1). amount_disputed_cents
 * is the contested amount; resolution_amount_cents is what was actually
 * recovered/lost on close. status walks open → won | lost | partial |
 * withdrawn. The win/loss rate + avg resolution time on the dispute log read
 * off these rows.
 *
 * Defined in packages/db/sql/0043_fraud_detection.sql.
 */
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const disputeTypeValues = ['pricing', 'service', 'fraud', 'duplicate', 'other'] as const;
export type DisputeType = (typeof disputeTypeValues)[number];

export const disputeStatusValues = ['open', 'won', 'lost', 'withdrawn', 'partial'] as const;
export type DisputeStatus = (typeof disputeStatusValues)[number];

export const disputeRecords = pgTable(
  'dispute_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    motorClubName: text('motor_club_name').notNull(),
    disputeType: text('dispute_type', { enum: disputeTypeValues }).notNull().default('other'),
    disputedAt: timestamp('disputed_at', { withTimezone: true }).notNull().defaultNow(),
    amountDisputedCents: bigint('amount_disputed_cents', { mode: 'number' }).notNull().default(0),
    status: text('status', { enum: disputeStatusValues }).notNull().default('open'),
    resolutionAt: timestamp('resolution_at', { withTimezone: true }),
    resolutionAmountCents: bigint('resolution_amount_cents', { mode: 'number' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('dispute_records_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.disputedAt,
    ),
    tenantClubIdx: index('dispute_records_tenant_club_idx').on(t.tenantId, t.motorClubName),
    tenantJobIdx: index('dispute_records_tenant_job_idx').on(t.tenantId, t.jobId),
  }),
);

export type DisputeRecord = typeof disputeRecords.$inferSelect;
export type NewDisputeRecord = typeof disputeRecords.$inferInsert;
