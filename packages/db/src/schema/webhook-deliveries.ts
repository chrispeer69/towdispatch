/**
 * webhook_deliveries — one row per (event, endpoint) attempt set (Session 29).
 *
 * The publisher inserts a row (status='pending', attempt=0, next_retry_at=now)
 * for every active endpoint subscribed to the fired event. The delivery cron
 * sweeps pending rows whose next_retry_at has passed, POSTs the signed
 * payload, and either marks it delivered or schedules the next retry on the
 * fixed backoff ladder (1m, 5m, 30m, 2h, 12h) up to max_attempts.
 *
 * `id` doubles as the idempotency key delivered to the consumer (payload.id +
 * the X-TowCommand-Delivery-Id header), so a retried delivery is dedupable
 * downstream. response_body is truncated before persistence; we never store
 * secrets here.
 *
 * Defined in packages/db/sql/0037_public_api.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { webhookEndpoints } from './webhook-endpoints';

export const webhookDeliveryStatusValues = [
  'pending',
  'delivering',
  'delivered',
  'failed',
] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusValues)[number];

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventId: uuid('event_id'),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: webhookDeliveryStatusValues }).notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantEndpointIdx: index('webhook_deliveries_tenant_endpoint_idx')
      .on(t.tenantId, t.endpointId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    dueIdx: index('webhook_deliveries_due_idx')
      .on(t.nextRetryAt)
      .where(sql`status = 'pending' AND deleted_at IS NULL`),
  }),
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
