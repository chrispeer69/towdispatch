/**
 * tenant_branding — per-tenant white-label configuration (Session 32).
 *
 * One row per tenant; `tenantId` is both primary key and FK. Drives the
 * customer-facing portal's look (logo, colors), support contact, legal
 * footer (terms/privacy URLs) and the optional vanity domain. Colors are
 * 7-char hex (#RRGGBB) — the web layer injects them as CSS variables.
 *
 * Defined in packages/db/sql/0037_white_label_portal.sql.
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const tenantBranding = pgTable('tenant_branding', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color'),
  accentColor: text('accent_color'),
  supportEmail: text('support_email'),
  supportPhone: text('support_phone'),
  termsUrl: text('terms_url'),
  privacyUrl: text('privacy_url'),
  customDomain: text('custom_domain'),
  customDomainVerifiedAt: timestamp('custom_domain_verified_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantBranding = typeof tenantBranding.$inferSelect;
export type NewTenantBranding = typeof tenantBranding.$inferInsert;
