/**
 * scim_tokens — bearer tokens for the SCIM 2.0 provisioning surface
 * (Session 38). Only sha256(plain) is stored (tokenHash); the plaintext is
 * shown once at mint. Lookup is by globally-unique tokenHash via the admin
 * pool — the SCIM request carries no tenant context, so the hash resolves
 * the tenant.
 *
 * Defined in packages/db/sql/0048_enterprise_sso.sql.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ssoConnections } from './sso-connections';
import { tenants } from './tenants';
import { users } from './users';

export const scimTokens = pgTable(
  'scim_tokens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id').references(() => ssoConnections.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('scim_tokens_tenant_idx').on(t.tenantId),
  }),
);

export type ScimToken = typeof scimTokens.$inferSelect;
export type NewScimToken = typeof scimTokens.$inferInsert;
