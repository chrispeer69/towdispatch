/**
 * service_rates — Master Rate Sheet pricing rows (Admin Settings build 2 of 6).
 *
 * One row per (service_catalog.id, vehicle_class). For class-independent
 * services (applicable_vehicle_classes = '{}'), the row uses
 * vehicle_class = 'any' as a sentinel so the table shape stays uniform.
 *
 * Tenant_id is denormalized for RLS, and a trigger (fn_service_rates_tenant
 * _consistency) enforces it matches the parent service_catalog row so an
 * attacker who knows a foreign service_id can't sneak a row past the policy.
 *
 * Soft delete is NOT modeled — operators "clear" a price by deleting the row,
 * which falls the rate engine back to the legacy rate_sheets JSON.
 */
import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { serviceCatalog } from './service-catalog';
import { tenants } from './tenants';
import { users } from './users';

export const serviceRates = pgTable(
  'service_rates',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: 'cascade' }),
    /**
     * One of the @towdispatch/shared VehicleClass values, or the literal
     * 'any' sentinel for class-independent services (Admin Fee, Storage by
     * day, etc.). Validated app-side; CHECK in 0023 enforces the same list.
     */
    vehicleClass: text('vehicle_class').notNull(),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    serviceClassUnique: uniqueIndex('service_rates_service_class_unique').on(
      t.serviceId,
      t.vehicleClass,
    ),
    tenantIdx: index('service_rates_tenant_idx').on(t.tenantId),
  }),
);

export type ServiceRateRow = typeof serviceRates.$inferSelect;
export type NewServiceRateRow = typeof serviceRates.$inferInsert;

export const SERVICE_RATE_ANY_CLASS = 'any' as const;
