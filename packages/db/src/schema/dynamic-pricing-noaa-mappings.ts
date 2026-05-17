/**
 * dynamic_pricing_noaa_mappings — operator-configurable mapping of NOAA
 * alert types to multipliers (Moat #1, Weather tier).
 *
 * Seeded with 12 defaults at tenant creation (or on first mapping save):
 *   Winter Storm Warning → 1.5×, Blizzard Warning → 2.0×, Ice Storm → 2.0×,
 *   Severe Thunderstorm → 1.3×, Tornado Warning → 1.8×, Hurricane → 2.5×,
 *   Tropical Storm → 1.5×, Flood Warning → 1.4×, Excessive Heat → 1.2×,
 *   Dense Fog → 1.1×, High Wind → 1.3×, Freeze Warning → 1.2×.
 *
 * One row per (tenant_id, noaa_alert_type).
 */
import { boolean, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const dynamicPricingNoaaMappings = pgTable(
  'dynamic_pricing_noaa_mappings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    noaaAlertType: text('noaa_alert_type').notNull(),
    multiplier: numeric('multiplier', { precision: 5, scale: 3 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantAlertUnique: uniqueIndex('dpnm_tenant_alert_unique').on(t.tenantId, t.noaaAlertType),
  }),
);

export type DynamicPricingNoaaMapping = typeof dynamicPricingNoaaMappings.$inferSelect;
export type NewDynamicPricingNoaaMapping = typeof dynamicPricingNoaaMappings.$inferInsert;
