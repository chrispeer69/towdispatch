/**
 * dynamic_pricing_holiday_calendar — operator-configurable holiday/event
 * multipliers (Moat #1, Calendar tier).
 *
 * `occurrence` distinguishes fixed-date (Jul 4) from nth-weekday (last
 * Monday of May = Memorial Day). `date_spec` is jsonb:
 *   - fixed_date  → { month: 7, day: 4 }
 *   - nth_weekday → { month: 11, weekday: 4 (Thu), ordinal: 4 } for Thanksgiving
 *
 * Seeded with 14 US federal holiday defaults at tenant creation; operator
 * can edit, disable, or add custom entries.
 */
import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const dynamicPricingHolidayOccurrenceValues = ['fixed_date', 'nth_weekday'] as const;
export type DynamicPricingHolidayOccurrence =
  (typeof dynamicPricingHolidayOccurrenceValues)[number];

export const dynamicPricingHolidayCalendar = pgTable(
  'dynamic_pricing_holiday_calendar',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    occurrence: text('occurrence', { enum: dynamicPricingHolidayOccurrenceValues }).notNull(),
    dateSpec: jsonb('date_spec').notNull(),
    multiplier: numeric('multiplier', { precision: 5, scale: 3 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantEnabledIdx: index('dphc_tenant_enabled_idx').on(t.tenantId, t.isEnabled),
  }),
);

export type DynamicPricingHoliday = typeof dynamicPricingHolidayCalendar.$inferSelect;
export type NewDynamicPricingHoliday = typeof dynamicPricingHolidayCalendar.$inferInsert;
