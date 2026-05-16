/**
 * service_catalog — the tenant-level list of services the operator bills for
 * (Tow, Mileage, Admin Fee, Storage, etc.). This is the *structure* of what a
 * tenant sells; pricing lives in `rate_sheets` (the Master Rate Sheet is build
 * 2 of the Admin Settings rollout) and per-account overrides land in build 5.
 *
 * `code` is the stable, tenant-scoped identifier (uppercase + underscore) that
 * the rate sheet, invoice line item, and (future) Workflow Template all refer
 * to. `name` is the human label shown in the dispatcher UI.
 *
 * `calculation_unit` records HOW the service is billed (per call, per mile,
 * per hour, per quarter hour, per day, or "quoted" meaning the dispatcher
 * enters the amount at quote time). `is_quoted` is the canonical
 * "price-entered-at-quote-time" flag; the migration enforces a CHECK that the
 * two agree (is_quoted ⟺ calculation_unit = 'quoted') so we don't end up with
 * contradictory states. Either field can be set in the UI and the other is
 * derived on save.
 *
 * `supports_per_resource_multiplier` is the Cleanup pattern: billed per-hour-
 * per-man, so the dispatcher enters a resource count at quote time and the
 * engine multiplies. Only meaningful for calculation_unit = per_hour /
 * per_quarter_hour.
 *
 * `applicable_vehicle_classes` is a subset of the VehicleClass enum in
 * @ustowdispatch/shared. An empty array means "class-independent" (Admin Fee,
 * Storage by day, etc.). The check is enforced application-side because
 * postgres CHECK can't reference TS enums and we don't want to maintain a
 * parallel DB-side list.
 *
 * `default_commission_pct_override`: when NULL, the driver's default
 * commission % applies. When set (0-100), this service uses the override
 * regardless of driver. Per the founder's spec, Fuel (cost of fuel) and
 * similar pass-through line items still earn the default commission, so they
 * stay NULL.
 *
 * Soft delete via `deleted_at` matches the rest of the codebase; the active
 * toggle (`is_active`) is the UI-facing "hide from intake without losing
 * history" switch. The unique index on (tenant_id, code) excludes soft-
 * deleted rows so a code can be re-used after a tombstone.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const serviceCategoryValues = [
  'towing',
  'mileage',
  'roadside_service',
  'recovery',
  'storage_impound',
  'fees_surcharges',
  'adjustments',
  'equipment',
  'overages',
] as const;
export type ServiceCategory = (typeof serviceCategoryValues)[number];

export const serviceCalculationUnitValues = [
  'per_call',
  'per_mile',
  'per_hour',
  'per_quarter_hour',
  'per_day',
  'quoted',
] as const;
export type ServiceCalculationUnit = (typeof serviceCalculationUnitValues)[number];

export const serviceCatalog = pgTable(
  'service_catalog',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    category: text('category', { enum: serviceCategoryValues }).notNull(),
    calculationUnit: text('calculation_unit', { enum: serviceCalculationUnitValues }).notNull(),

    /**
     * Subset of @ustowdispatch/shared VehicleClass values. Empty array = the
     * service is class-independent (Admin Fee, Storage, etc.). Validated
     * application-side; the DB column is just text[].
     */
    applicableVehicleClasses: text('applicable_vehicle_classes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    isQuoted: boolean('is_quoted').notNull().default(false),

    /**
     * 0-100 inclusive. NULL means "use the driver's default commission %".
     * Stored as numeric(5,2) end-to-end as a string so we don't drift on the
     * round-trip through JS Number.
     */
    defaultCommissionPctOverride: numeric('default_commission_pct_override', {
      precision: 5,
      scale: 2,
    }),

    /**
     * True for services like Cleanup that bill per-hour-per-man. The
     * dispatcher supplies a resource count at quote time and the engine
     * multiplies. Only meaningful for calculation_unit in
     * {per_hour, per_quarter_hour}.
     */
    supportsPerResourceMultiplier: boolean('supports_per_resource_multiplier')
      .notNull()
      .default(false),

    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // Unique per tenant, excluding tombstones so a code can be re-used.
    tenantCodeUnique: uniqueIndex('service_catalog_tenant_code_unique')
      .on(t.tenantId, t.code)
      .where(sql`deleted_at IS NULL`),
    tenantCategoryIdx: index('service_catalog_tenant_category_idx').on(t.tenantId, t.category),
    tenantActiveIdx: index('service_catalog_tenant_active_idx').on(t.tenantId, t.isActive),
  }),
);

export type ServiceCatalogRow = typeof serviceCatalog.$inferSelect;
export type NewServiceCatalogRow = typeof serviceCatalog.$inferInsert;
