/**
 * dynamic_pricing_curves — 24-hour or 7×24 multiplier curves used by the
 * Time of Day tier category (Moat #1). `curve_data` is jsonb:
 *   - mode = "24_hour"  → array of 24 numbers (multiplier per hour 0..23)
 *   - mode = "7x24"     → array of 7 arrays of 24 numbers (Sun..Sat)
 *
 * Soft-deleted; tenants typically have one active curve at a time.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const dynamicPricingCurveModeValues = ['24_hour', '7x24'] as const;
export type DynamicPricingCurveMode = (typeof dynamicPricingCurveModeValues)[number];

export const dynamicPricingCurves = pgTable(
  'dynamic_pricing_curves',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    mode: text('mode', { enum: dynamicPricingCurveModeValues }).notNull(),
    curveData: jsonb('curve_data').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('dynamic_pricing_curves_tenant_active_idx').on(t.tenantId, t.isActive),
  }),
);

export type DynamicPricingCurve = typeof dynamicPricingCurves.$inferSelect;
export type NewDynamicPricingCurve = typeof dynamicPricingCurves.$inferInsert;
