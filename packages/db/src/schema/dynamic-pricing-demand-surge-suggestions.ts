/**
 * dynamic_pricing_demand_surge_suggestions — pending demand surge
 * suggestions from the hourly cron (Moat #1).
 *
 * Cron measures active-job count vs. trailing 4-week same-hour-same-
 * weekday baseline per yard. When current exceeds a configured threshold
 * (default 150 / 200 / 300 %), it writes a row here. Operator approves
 * (creates a tier activation) or dismisses on the Control Panel.
 *
 * One pending suggestion at a time per (tenant, yard, threshold) is
 * enforced by a partial unique index in the migration.
 */
import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const dynamicPricingDemandSurgeStatusValues = ['pending', 'approved', 'dismissed'] as const;
export type DynamicPricingDemandSurgeStatus =
  (typeof dynamicPricingDemandSurgeStatusValues)[number];

export const dynamicPricingDemandSurgeSuggestions = pgTable(
  'dynamic_pricing_demand_surge_suggestions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    yardId: uuid('yard_id'),
    thresholdPct: integer('threshold_pct').notNull(),
    suggestedMultiplier: numeric('suggested_multiplier', { precision: 5, scale: 3 }).notNull(),
    currentJobs: integer('current_jobs').notNull(),
    baselineJobs: numeric('baseline_jobs', { precision: 8, scale: 2 }).notNull(),
    status: text('status', { enum: dynamicPricingDemandSurgeStatusValues })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    tenantStatusIdx: index('dpdss_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
  }),
);

export type DynamicPricingDemandSurgeSuggestion =
  typeof dynamicPricingDemandSurgeSuggestions.$inferSelect;
export type NewDynamicPricingDemandSurgeSuggestion =
  typeof dynamicPricingDemandSurgeSuggestions.$inferInsert;
