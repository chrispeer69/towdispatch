/**
 * storage_rate_cards — per-facility, per-vehicle-class daily storage rate
 * effective over a date window (Yard Management, Session 54). free_days
 * waives the first N days; max_daily_rate_cents caps a day (NULL =
 * uncapped). Defined in packages/db/sql/0051_yard_management.sql.
 */
import { sql } from 'drizzle-orm';
import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { yardFacilities } from './yard-facilities';

export const storageVehicleClassValues = [
  'passenger',
  'light_truck',
  'heavy',
  'motorcycle',
  'trailer',
  'rv',
] as const;
export type StorageVehicleClass = (typeof storageVehicleClassValues)[number];

export const storageRateCards = pgTable(
  'storage_rate_cards',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => yardFacilities.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    vehicleClass: text('vehicle_class', { enum: storageVehicleClassValues }).notNull(),
    dailyRateCents: integer('daily_rate_cents').notNull(),
    freeDays: integer('free_days').notNull().default(0),
    maxDailyRateCents: integer('max_daily_rate_cents'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantFacilityClassIdx: index('storage_rate_cards_tenant_facility_class_idx')
      .on(t.tenantId, t.facilityId, t.vehicleClass, t.effectiveFrom)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type StorageRateCard = typeof storageRateCards.$inferSelect;
export type NewStorageRateCard = typeof storageRateCards.$inferInsert;
