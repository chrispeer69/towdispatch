import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customerPortalSessions } from './customer-portal-sessions';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';

export const customerPortalReleaseIntentStatusValues = [
  'initiated',
  'id_provided',
  'paid',
  'ready_for_gate',
  'cancelled',
  'gate_completed',
] as const;

/**
 * The online "get my car back" flow + status machine (Session 55). A single
 * full PaymentIntent flips paid -> ready_for_gate; partial payments disallowed
 * in v1. `ready_for_gate` is the yard-gate handoff signal.
 */
export const customerPortalReleaseIntents = pgTable(
  'customer_portal_release_intents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => customerPortalSessions.id, { onDelete: 'cascade' }),
    impoundId: uuid('impound_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'restrict' }),
    status: text('status', { enum: customerPortalReleaseIntentStatusValues })
      .notNull()
      .default('initiated'),
    totalDueCents: bigint('total_due_cents', { mode: 'number' }).notNull(),
    paidCents: bigint('paid_cents', { mode: 'number' }).notNull().default(0),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
    readyForGateAt: timestamp('ready_for_gate_at', { withTimezone: true }),
    gateCompletedAt: timestamp('gate_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('customer_portal_release_intents_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    sessionIdx: index('customer_portal_release_intents_session_idx')
      .on(t.tenantId, t.sessionId)
      .where(sql`deleted_at IS NULL`),
    paymentIntentUnique: uniqueIndex('customer_portal_release_intents_pi_unique')
      .on(t.tenantId, t.stripePaymentIntentId)
      .where(sql`stripe_payment_intent_id IS NOT NULL AND deleted_at IS NULL`),
  }),
);

export type CustomerPortalReleaseIntent = typeof customerPortalReleaseIntents.$inferSelect;
export type NewCustomerPortalReleaseIntent = typeof customerPortalReleaseIntents.$inferInsert;
