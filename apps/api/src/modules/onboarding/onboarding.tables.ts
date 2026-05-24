/**
 * Drizzle table definitions for the two onboarding tables, declared LOCAL to
 * this module.
 *
 * They are intentionally NOT registered in packages/db/src/schema (out of this
 * session's allowed scope). The Drizzle query *builder* (tx.select/insert/
 * update) works with any pgTable object regardless of the `schema` option
 * passed to drizzle() — only the relational `tx.query.*` API needs
 * registration, which this module does not use. DDL lives in
 * packages/db/sql/0036_onboarding.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ACTIVATION_EVENTS, ONBOARDING_STEPS, ONBOARDING_TIERS } from './onboarding.contracts.js';

export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    currentStep: text('current_step', { enum: ONBOARDING_STEPS }).notNull().default('company_info'),
    stepsCompleted: text('steps_completed', { enum: ONBOARDING_STEPS })
      .array()
      .notNull()
      .default(sql`'{}'`),
    stepData: jsonb('step_data').notNull().default({}),
    tier: text('tier', { enum: ONBOARDING_TIERS }).notNull().default('free'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
  },
  (t) => ({
    tenantLiveUnique: uniqueIndex('onboarding_progress_tenant_live_unique')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export const tenantActivationEvents = pgTable(
  'tenant_activation_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    eventType: text('event_type', { enum: ACTIVATION_EVENTS }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => ({
    tenantTypeUnique: uniqueIndex('tenant_activation_events_tenant_type_unique').on(
      t.tenantId,
      t.eventType,
    ),
    tenantOccurredIdx: index('tenant_activation_events_tenant_occurred_idx').on(
      t.tenantId,
      t.occurredAt,
    ),
  }),
);

export type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;
export type TenantActivationEventRow = typeof tenantActivationEvents.$inferSelect;
