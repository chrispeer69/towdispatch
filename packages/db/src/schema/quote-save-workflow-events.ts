/**
 * quote_save_workflow_events — append-only event trail of the structured
 * save funnel that fires when a customer declines a quote (Moat #8 inside
 * Moat #1).
 *
 * Steps in canonical order:
 *   save_step_1            — offer 5% discount
 *   save_step_2            — offer additional 5% (total 10%)
 *   save_step_counter      — operator types a custom counter price
 *   save_step_manager_call — final fallback "have a manager call me"
 *
 * The state machine in `save-workflow.service.ts` enforces ordering and
 * rejects illegal skips. `decline_reason_code` is captured on the first
 * decline event; subsequent steps inherit that reason.
 */
import { bigint, boolean, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const quoteSaveWorkflowStepValues = [
  'save_step_1',
  'save_step_2',
  'save_step_counter',
  'save_step_manager_call',
] as const;
export type QuoteSaveWorkflowStep = (typeof quoteSaveWorkflowStepValues)[number];

export const quoteDeclineReasonValues = [
  'too_expensive',
  'found_alternative',
  'no_longer_needs',
  'eta_too_long',
  'payment_issue',
  'customer_changed_mind',
  'other',
] as const;
export type QuoteDeclineReason = (typeof quoteDeclineReasonValues)[number];

export const quoteSaveWorkflowEvents = pgTable(
  'quote_save_workflow_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    step: text('step', { enum: quoteSaveWorkflowStepValues }).notNull(),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }),
    customPriceCents: bigint('custom_price_cents', { mode: 'number' }),
    declineReasonCode: text('decline_reason_code', { enum: quoteDeclineReasonValues }),
    accepted: boolean('accepted').notNull().default(false),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantJobIdx: index('qswe_tenant_job_idx').on(t.tenantId, t.jobId, t.createdAt),
    tenantCreatedIdx: index('qswe_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type QuoteSaveWorkflowEvent = typeof quoteSaveWorkflowEvents.$inferSelect;
export type NewQuoteSaveWorkflowEvent = typeof quoteSaveWorkflowEvents.$inferInsert;
