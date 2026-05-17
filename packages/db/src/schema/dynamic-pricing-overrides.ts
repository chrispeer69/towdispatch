/**
 * dynamic_pricing_overrides — append-only log of every operator manual
 * price override on a quote (Moat #1).
 *
 * Reason codes are enforced both at the controller (zod) and DB (CHECK
 * constraint). `tier_stack_snapshot` captures the full live tier stack at
 * override time so the Override Report can show "what would have applied
 * if you hadn't overridden". The `note` field is required only for
 * `other_with_note`; the DB enforces this.
 *
 * `job_id` is the equivalent of the spec's "quote_id" — Build 1's quote
 * surface is the jobs table (rate_quoted_cents on jobs is the live quote).
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const dynamicPricingOverrideReasonValues = [
  'price_match',
  'customer_complaint',
  'manager_approved',
  'goodwill',
  'error_correction',
  'competitive_pressure',
  'other_with_note',
] as const;
export type DynamicPricingOverrideReason = (typeof dynamicPricingOverrideReasonValues)[number];

export const dynamicPricingOverrides = pgTable(
  'dynamic_pricing_overrides',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    originalPriceCents: bigint('original_price_cents', { mode: 'number' }).notNull(),
    overridePriceCents: bigint('override_price_cents', { mode: 'number' }).notNull(),
    tierStackSnapshot: jsonb('tier_stack_snapshot').notNull().default([]),
    reasonCode: text('reason_code', { enum: dynamicPricingOverrideReasonValues }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantJobIdx: index('dpo_tenant_job_idx').on(t.tenantId, t.jobId),
    tenantCreatedIdx: index('dpo_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type DynamicPricingOverride = typeof dynamicPricingOverrides.$inferSelect;
export type NewDynamicPricingOverride = typeof dynamicPricingOverrides.$inferInsert;
