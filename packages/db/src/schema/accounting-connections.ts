/**
 * accounting_connections — Session 12.
 *
 * One row per (tenant_id, provider) when a tenant has begun or completed an
 * OAuth connection. Encrypted tokens live here, never raw. A partial unique
 * index (status IN connected/pending) keeps a tenant from accidentally
 * holding two live connections to the same provider; once a connection is
 * disconnected/errored the row stays for audit but a fresh connect can be
 * issued.
 */
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const accountingProviderValues = ['quickbooks-online', 'quickbooks-online-stub'] as const;
export type AccountingProviderId = (typeof accountingProviderValues)[number];

export const accountingConnectionStatusValues = [
  'pending',
  'connected',
  'disconnected',
  'error',
] as const;
export type AccountingConnectionStatus = (typeof accountingConnectionStatusValues)[number];

export const accountingConnections = pgTable(
  'accounting_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    provider: text('provider', { enum: accountingProviderValues }).notNull(),
    /** QBO company id ("realmId"); null for providers that don't use one. */
    realmId: text('realm_id'),
    sandbox: boolean('sandbox').notNull().default(false),

    status: text('status', { enum: accountingConnectionStatusValues }).notNull().default('pending'),

    /** AES-256-GCM ciphertext base64. Never log this column. */
    encryptedAccessToken: text('encrypted_access_token'),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),

    /** Per-connection verifier used to validate incoming webhook signatures. */
    webhookVerifierToken: text('webhook_verifier_token'),

    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),

    connectedAt: timestamp('connected_at', { withTimezone: true }),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantProviderIdx: index('accounting_connections_tenant_provider_idx').on(
      t.tenantId,
      t.provider,
    ),
  }),
);

export type AccountingConnection = typeof accountingConnections.$inferSelect;
export type NewAccountingConnection = typeof accountingConnections.$inferInsert;
