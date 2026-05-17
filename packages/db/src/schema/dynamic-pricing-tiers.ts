/**
 * dynamic_pricing_tiers — tier definitions per tenant (Moat #1).
 *
 * Five categories: weather, traffic, calendar, time_of_day, special_event.
 * `multiplier` is the price multiplier (1.0–10.0). `scope_yard_ids` empty
 * or null = applies to all yards in the tenant. `is_active` is the live
 * flag the rate engine reads; activations/deactivations also leave a trail
 * in `dynamic_pricing_tier_activations`.
 *
 * Soft-deleted (`deleted_at`) rather than hard-deleted so historical
 * activations and audit rows still resolve their tier name.
 */
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const dynamicPricingCategoryValues = [
  'weather',
  'traffic',
  'calendar',
  'time_of_day',
  'special_event',
] as const;
export type DynamicPricingCategory = (typeof dynamicPricingCategoryValues)[number];

export const dynamicPricingTiers = pgTable(
  'dynamic_pricing_tiers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    category: text('category', { enum: dynamicPricingCategoryValues }).notNull(),
    multiplier: numeric('multiplier', { precision: 5, scale: 3 }).notNull(),
    scopeYardIds: uuid('scope_yard_ids').array(),
    isActive: boolean('is_active').notNull().default(false),
    schedule: jsonb('schedule'),
    autoRevertAt: timestamp('auto_revert_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('dynamic_pricing_tiers_tenant_active_idx').on(t.tenantId, t.isActive),
    tenantCategoryIdx: index('dynamic_pricing_tiers_tenant_category_idx').on(
      t.tenantId,
      t.category,
    ),
  }),
);

export type DynamicPricingTier = typeof dynamicPricingTiers.$inferSelect;
export type NewDynamicPricingTier = typeof dynamicPricingTiers.$inferInsert;
