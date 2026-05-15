/**
 * rate_sheets — pricing rules used by the RateEngineService.
 *
 * One rate sheet captures the full pricing model: base hookup fees by service
 * type and vehicle class, per-mile rates, time-of-day surcharges, and any
 * fixed-amount line items the dispatcher should always quote (admin fee,
 * fuel surcharge, etc.). The full definition lives in `definition` (jsonb)
 * so we can iterate on the schema without DDL while we learn what real
 * tenants need.
 *
 * Account-level rate sheets win over tenant-default. Cash jobs (no account)
 * fall back to the tenant default. The default is materialized in
 * tenant_default_rate_sheets so we always know which sheet to apply without
 * re-deriving "newest active sheet" at quote time.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const rateSheets = pgTable(
  'rate_sheets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),

    /**
     * Full pricing definition. Shape lives in @ustowdispatch/shared
     * (rateSheetDefinitionSchema). Stored as jsonb so additive changes — new
     * service types, new surcharge windows — don't require migrations.
     */
    definition: jsonb('definition').notNull(),

    active: boolean('active').notNull().default(true),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantNameIdx: index('rate_sheets_tenant_name_idx').on(t.tenantId, t.name),
    tenantActiveIdx: index('rate_sheets_tenant_active_idx').on(t.tenantId, t.active),
  }),
);

export type RateSheet = typeof rateSheets.$inferSelect;
export type NewRateSheet = typeof rateSheets.$inferInsert;

/**
 * tenant_default_rate_sheets — exactly one row per tenant naming the rate
 * sheet to apply when no account override exists. PRIMARY KEY (tenant_id)
 * enforces the "exactly one" invariant.
 */
export const tenantDefaultRateSheets = pgTable('tenant_default_rate_sheets', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  rateSheetId: uuid('rate_sheet_id')
    .notNull()
    .references(() => rateSheets.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type TenantDefaultRateSheet = typeof tenantDefaultRateSheets.$inferSelect;
export type NewTenantDefaultRateSheet = typeof tenantDefaultRateSheets.$inferInsert;
