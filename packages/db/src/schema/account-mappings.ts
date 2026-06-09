/**
 * account_mappings — Session 12.
 *
 * Operator-defined mapping from US Tow Dispatch's internal billing categories
 * (e.g. "service_revenue", "fuel_surcharge", "storage", "tax_payable") onto
 * the corresponding external account ids in the provider's chart of accounts.
 *
 * One row per (tenant_id, provider, internal_category). Updating the mapping
 * is a regular UPSERT — there is no history; the audit_log row carries the
 * before/after state.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accountingProviderValues } from './accounting-connections';
import { tenants } from './tenants';

export const accountMappingInternalCategoryValues = [
  'service_revenue',
  'mileage_revenue',
  'wait_time_revenue',
  'storage_revenue',
  'recovery_revenue',
  'admin_fee_revenue',
  'tax_payable',
  'discounts',
  'platform_fees',
  'stripe_fees',
  'cash_clearing',
  'undeposited_funds',
  'accounts_receivable',
  'refunds',
] as const;
export type AccountMappingInternalCategory = (typeof accountMappingInternalCategoryValues)[number];

export const accountMappings = pgTable(
  'account_mappings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    provider: text('provider', { enum: accountingProviderValues }).notNull(),
    internalCategory: text('internal_category', {
      enum: accountMappingInternalCategoryValues,
    }).notNull(),

    externalAccountId: text('external_account_id').notNull(),
    externalAccountName: text('external_account_name'),
    externalAccountType: text('external_account_type'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantProviderIdx: index('account_mappings_tenant_provider_idx').on(t.tenantId, t.provider),
  }),
);

export type AccountMapping = typeof accountMappings.$inferSelect;
export type NewAccountMapping = typeof accountMappings.$inferInsert;
