/**
 * dynamic_pricing_tier_activations — append-only event log of every tier
 * activation / deactivation (Moat #1). One row per activation; the same
 * row's `deactivated_at` is filled in when the tier turns off.
 *
 * Cron-initiated activations record the system user UUID
 * (00000000-0000-0000-0000-000000000000) in `activated_by_user_id`; manual
 * activations record the operator user_id.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dynamicPricingTiers } from './dynamic-pricing-tiers';
import { tenants } from './tenants';

export const dynamicPricingTierActivations = pgTable(
  'dynamic_pricing_tier_activations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => dynamicPricingTiers.id, { onDelete: 'restrict' }),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    activatedByUserId: uuid('activated_by_user_id'),
    deactivatedByUserId: uuid('deactivated_by_user_id'),
    activationReason: text('activation_reason'),
    deactivationReason: text('deactivation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTierIdx: index('dpta_tenant_tier_idx').on(t.tenantId, t.tierId, t.activatedAt),
    tenantActivatedIdx: index('dpta_tenant_activated_idx').on(t.tenantId, t.activatedAt),
  }),
);

export type DynamicPricingTierActivation = typeof dynamicPricingTierActivations.$inferSelect;
export type NewDynamicPricingTierActivation = typeof dynamicPricingTierActivations.$inferInsert;
