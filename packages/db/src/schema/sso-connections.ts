/**
 * sso_connections — one IdP binding per (tenant, provider) for Enterprise
 * SSO (Session 38). `provider` is 'saml' | 'oidc'. SAML pins x509Cert +
 * ssoUrl (no metadata trust-on-first-use); OIDC uses issuer discovery +
 * oidcClientId/oidcClientSecretEncrypted (AES-256-GCM at rest).
 * attributeMapping maps IdP claim names onto our user fields. One live
 * connection per (tenant, provider) — partial unique index in the migration.
 *
 * Defined in packages/db/sql/0048_enterprise_sso.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const ssoProviderValues = ['saml', 'oidc'] as const;
export type SsoProvider = (typeof ssoProviderValues)[number];

/** IdP claim/attribute names mapped onto our user fields. */
export interface SsoAttributeMapping {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  role?: string | undefined;
}

export const ssoConnections = pgTable(
  'sso_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    provider: text('provider', { enum: ssoProviderValues }).notNull(),
    displayName: text('display_name').notNull(),
    issuer: text('issuer'),
    metadataUrl: text('metadata_url'),
    x509Cert: text('x509_cert'),
    ssoUrl: text('sso_url'),
    sloUrl: text('slo_url'),
    audience: text('audience'),
    oidcClientId: text('oidc_client_id'),
    oidcClientSecretEncrypted: text('oidc_client_secret_encrypted'),
    oidcScopes: text('oidc_scopes').notNull().default('openid email profile'),
    attributeMapping: jsonb('attribute_mapping').$type<SsoAttributeMapping>().notNull().default({}),
    defaultRole: text('default_role').notNull().default('dispatcher'),
    enabled: boolean('enabled').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantEnabledIdx: index('sso_connections_tenant_enabled_idx')
      .on(t.tenantId, t.enabled)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type SsoConnection = typeof ssoConnections.$inferSelect;
export type NewSsoConnection = typeof ssoConnections.$inferInsert;
