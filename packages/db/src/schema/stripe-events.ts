/**
 * stripe_events — Session 11 webhook idempotency ledger.
 *
 * Stripe retries deliveries on any non-2xx response. To avoid double-recording
 * a payment we INSERT … ON CONFLICT DO NOTHING using Stripe's event id as the
 * primary key. If the insert "creates" a row we run handlers; if it didn't
 * we early-return as a duplicate.
 *
 * Platform-wide table (no tenant_id required at insert time — events arrive
 * before we resolve them to a tenant). RLS is therefore disabled in
 * sql/0014_stripe_payments.sql; the only writers are the webhook controller
 * and the (eventual) cron sweeper, both of which use the admin pool.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const stripeEvents = pgTable(
  'stripe_events',
  {
    /** Stripe's `evt_xxx` id. */
    id: text('id').primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    livemode: boolean('livemode').notNull().default(false),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
  },
  (t) => ({
    typeIdx: index('stripe_events_type_idx').on(t.type, t.receivedAt),
    tenantIdx: index('stripe_events_tenant_idx').on(t.tenantId, t.receivedAt),
  }),
);

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;
