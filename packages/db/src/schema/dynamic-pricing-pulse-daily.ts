/**
 * dynamic_pricing_pulse_daily — denormalized daily aggregate (Moat #1).
 *
 * One row per (tenant_id, pulse_date). `pulse_date` is the calendar date
 * in the tenant's local timezone. Updated on every quote acceptance via
 * `pulse-aggregator.service.ts` UPSERT-on-conflict so the dashboard never
 * scans the whole quotes table.
 *
 * `by_tier` jsonb shape: { [tierId]: { name, category, multiplier,
 * accepted_count, contribution_cents } }.
 */
import { bigint, integer, jsonb, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { date } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const dynamicPricingPulseDaily = pgTable(
  'dynamic_pricing_pulse_daily',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    pulseDate: date('pulse_date').notNull(),
    revenueCents: bigint('revenue_cents', { mode: 'number' }).notNull().default(0),
    standardRevenueCents: bigint('standard_revenue_cents', { mode: 'number' }).notNull().default(0),
    deltaCents: bigint('delta_cents', { mode: 'number' }).notNull().default(0),
    acceptedQuoteCount: integer('accepted_quote_count').notNull().default(0),
    byTier: jsonb('by_tier').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.pulseDate] }),
  }),
);

export type DynamicPricingPulseDay = typeof dynamicPricingPulseDaily.$inferSelect;
export type NewDynamicPricingPulseDay = typeof dynamicPricingPulseDaily.$inferInsert;
