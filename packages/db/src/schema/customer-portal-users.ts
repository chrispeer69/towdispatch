/**
 * customer_portal_users — white-label portal logins (Session 32).
 *
 * Deliberately SEPARATE from the staff `users` table: a portal credential
 * can never authenticate against the operator API surface (different table,
 * different JWT audience/secret, different guard). Each portal user is bound
 * to exactly one `customers` row (the person whose vehicle was towed) in the
 * same tenant — enforced by a cross-tenant-consistency BEFORE trigger in SQL.
 *
 * Cross-CUSTOMER isolation (a portal user only sees their own customer's
 * jobs/invoices) is enforced in the service layer, NOT by RLS — RLS isolates
 * by tenant only.
 *
 * Defined in packages/db/sql/0037_white_label_portal.sql.
 */
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers';
import { tenants } from './tenants';

export const customerPortalUsers = pgTable(
  'customer_portal_users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // (tenant_id, lower(email)) uniqueness for live rows is a partial unique
    // index defined in sql/0037 (Drizzle index() doesn't model WHERE cleanly).
    tenantCustomerIdx: index('customer_portal_users_tenant_customer_idx').on(
      t.tenantId,
      t.customerId,
    ),
  }),
);

export type CustomerPortalUser = typeof customerPortalUsers.$inferSelect;
export type NewCustomerPortalUser = typeof customerPortalUsers.$inferInsert;
