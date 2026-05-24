/**
 * onboarding_progress — one live row per tenant tracking the self-serve
 * onboarding wizard.
 *
 * Created the moment a tenant is provisioned via POST /onboarding/start.
 * `currentStep` is the wizard resume point; `stepsCompleted` is the audited
 * set of finished steps; `stepData` holds resumable form payloads (e.g. the
 * company-info the operator typed) so a half-finished wizard survives a
 * reload. `completedAt` is set when every required step is done.
 *
 * Soft-delete shaped, audited, FORCE RLS. Defined in
 * packages/db/sql/0036_onboarding.sql.
 */
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const onboardingStepValues = [
  'account',
  'verify_email',
  'company_info',
  'first_user',
  'first_truck',
  'first_driver',
  'dispatch_first_job',
  'completed',
] as const;
export type OnboardingStep = (typeof onboardingStepValues)[number];

export const onboardingTierValues = ['free', 'starter', 'pro'] as const;
export type OnboardingTier = (typeof onboardingTierValues)[number];

export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    currentStep: text('current_step', { enum: onboardingStepValues }).notNull().default('account'),
    stepsCompleted: text('steps_completed').array().notNull().default(sql`'{}'::text[]`),
    stepData: jsonb('step_data').notNull().default(sql`'{}'::jsonb`),
    tier: text('tier', { enum: onboardingTierValues }).notNull().default('free'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantLiveUnique: uniqueIndex('onboarding_progress_tenant_live_unique')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type NewOnboardingProgress = typeof onboardingProgress.$inferInsert;
