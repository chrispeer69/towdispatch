/**
 * account_service_availability — per-account flag for whether a service is
 * covered, not covered, or pre-approval required (Admin Settings build 6).
 *
 * The ABSENCE of a row for an (account, service) pair means 'available' —
 * dispatchers don't have to seed positive rows for the default case. Only
 * exceptions (not_covered, pre_approval_required) materialize on disk.
 *
 * Same RLS / audit / cross-tenant trigger pattern as account_rate_overrides.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { serviceCatalog } from './service-catalog';
import { tenants } from './tenants';
import { users } from './users';

export const accountServiceAvailabilityValues = [
  'available',
  'not_covered',
  'pre_approval_required',
] as const;
export type AccountServiceAvailability = (typeof accountServiceAvailabilityValues)[number];

export const accountServiceAvailability = pgTable(
  'account_service_availability',
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
    availability: text('availability', { enum: accountServiceAvailabilityValues })
      .notNull()
      .default('available'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantAccountIdx: index('account_service_availability_tenant_account_idx').on(
      t.tenantId,
      t.accountId,
    ),
  }),
);

export type AccountServiceAvailabilityRow = typeof accountServiceAvailability.$inferSelect;
export type NewAccountServiceAvailabilityRow = typeof accountServiceAvailability.$inferInsert;
