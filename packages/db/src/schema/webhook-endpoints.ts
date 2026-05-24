/**
 * webhook_endpoints — tenant-registered HTTPS sinks for Public API events
 * (Session 29).
 *
 * `secretEncrypted` holds the per-endpoint signing secret AES-256-GCM-
 * encrypted at rest (same pattern as users.totp_secret_encrypted /
 * accounting_connections token columns). It is NOT a hash: outbound delivery
 * must HMAC-SHA256-sign each request body with the plaintext secret, so the
 * worker decrypts it at send time. The secret is shown to the operator once,
 * at creation, and never logged.
 *
 * `events` is the subscription filter — the event-type strings (job.created,
 * job.status_changed, impound.opened, impound.released) this endpoint wants.
 *
 * Defined in packages/db/sql/0037_public_api.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    url: text('url').notNull(),
    description: text('description'),
    secretEncrypted: text('secret_encrypted').notNull(),
    events: text('events').array().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('webhook_endpoints_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
    tenantActiveIdx: index('webhook_endpoints_tenant_active_idx')
      .on(t.tenantId, t.active)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
