import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customerPortalReleaseIntents } from './customer-portal-release-intents';
import { customerPortalSessions } from './customer-portal-sessions';
import { tenants } from './tenants';

export const customerPortalPaymentStatusValues = [
  'pending',
  'succeeded',
  'failed',
  'refunded',
] as const;

/**
 * Portal-context audit mirror of the Stripe PaymentIntents created for release
 * intents (Session 55). The shared `stripe_events` table is the webhook
 * idempotency anchor; this is the per-tenant ledger keyed by PaymentIntent id.
 */
export const customerPortalPayments = pgTable(
  'customer_portal_payments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => customerPortalSessions.id, { onDelete: 'cascade' }),
    releaseIntentId: uuid('release_intent_id').references(() => customerPortalReleaseIntents.id, {
      onDelete: 'set null',
    }),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: text('status', { enum: customerPortalPaymentStatusValues })
      .notNull()
      .default('pending'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    errorText: text('error_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    paymentIntentUnique: uniqueIndex('customer_portal_payments_pi_unique')
      .on(t.tenantId, t.stripePaymentIntentId)
      .where(sql`deleted_at IS NULL`),
    releaseIntentIdx: index('customer_portal_payments_release_intent_idx')
      .on(t.tenantId, t.releaseIntentId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type CustomerPortalPayment = typeof customerPortalPayments.$inferSelect;
export type NewCustomerPortalPayment = typeof customerPortalPayments.$inferInsert;
