/**
 * public_api_idempotency_keys — replay cache for Public API writes (Session 29).
 *
 * When a consumer sends an `Idempotency-Key` header on a write (POST /v1/jobs),
 * we record the resulting response keyed by (tenant_id, idempotency_key). A
 * repeat with the SAME request fingerprint replays the stored response; a
 * repeat with a DIFFERENT fingerprint is rejected 409 (the key was reused for
 * a different request). This makes client retries on network failure safe.
 *
 * Defined in packages/db/sql/0037_public_api.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { apiKeys } from './api-keys';
import { tenants } from './tenants';

export const apiIdempotencyKeys = pgTable(
  'public_api_idempotency_keys',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantKeyUnique: index('public_api_idempotency_tenant_key_unique')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ApiIdempotencyKey = typeof apiIdempotencyKeys.$inferSelect;
export type NewApiIdempotencyKey = typeof apiIdempotencyKeys.$inferInsert;
