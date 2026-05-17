/**
 * account_rate_overrides — per-account pricing override rows (Admin Settings
 * build 6 of 7).
 *
 * One row per (tenant, account, service_catalog_id, vehicle_class). Three
 * override patterns, encoded in override_type:
 *   - flat_price           → override_value_cents is the new price in cents
 *   - flat_dollar_discount → override_value_cents is dollars off the master
 *   - percent_discount     → override_percent (0-100) is the % off master
 *
 * A CHECK constraint in 0028 guarantees exactly one of value/percent is in
 * use per row, so the rate-engine resolution math is unambiguous.
 *
 * tenant_id is denormalized for RLS; fn_account_rate_overrides_tenant_
 * consistency (BEFORE INSERT OR UPDATE) confirms both account_id and
 * service_catalog_id parent rows live in the same tenant. Matches the
 * Build 2 service_rates safety pattern.
 */
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { serviceCatalog } from './service-catalog';
import { tenants } from './tenants';
import { users } from './users';

export const accountRateOverrideTypeValues = [
  'flat_price',
  'percent_discount',
  'flat_dollar_discount',
] as const;
export type AccountRateOverrideType = (typeof accountRateOverrideTypeValues)[number];

export const accountRateOverrides = pgTable(
  'account_rate_overrides',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    serviceCatalogId: uuid('service_catalog_id')
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: 'restrict' }),
    /**
     * Matches the VehicleClass enum in @ustowdispatch/shared, or 'any' for
     * class-independent services. NULL = "no class scoping" (also class-
     * independent). Both forms are accepted at the API; the rate engine
     * treats null and 'any' identically.
     */
    vehicleClass: text('vehicle_class'),
    overrideType: text('override_type', { enum: accountRateOverrideTypeValues }).notNull(),
    overrideValueCents: integer('override_value_cents').notNull().default(0),
    overridePercent: numeric('override_percent', { precision: 5, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantAccountIdx: index('account_rate_overrides_tenant_account_idx').on(
      t.tenantId,
      t.accountId,
    ),
    tenantServiceIdx: index('account_rate_overrides_tenant_service_idx').on(
      t.tenantId,
      t.serviceCatalogId,
    ),
    tenantActiveIdx: index('account_rate_overrides_tenant_active_idx').on(t.tenantId, t.isActive),
  }),
);

export type AccountRateOverrideRow = typeof accountRateOverrides.$inferSelect;
export type NewAccountRateOverrideRow = typeof accountRateOverrides.$inferInsert;
