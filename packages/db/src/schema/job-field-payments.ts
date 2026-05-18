/**
 * job_field_payments — Stripe Terminal payments captured on-scene by
 * the driver. Distinct from the office-side `payments` table because
 * the lifecycle (intent → tap → capture/fail → office reconciliation)
 * is the driver app's domain.
 *
 * stripe_payment_intent_id is globally unique (partial index ignores
 * NULL). client_idempotency_key is unique per (tenant, key) so a flaky
 * tap retry doesn't double-charge.
 *
 * Cross-tenant consistency trigger in the SQL migration enforces that
 * job_id's tenant matches the row's tenant_id.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { driverShifts } from './driver-shifts';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const jobFieldPaymentMethodValues = [
  'card_present_tap',
  'card_present_chip',
  'card_present_swipe',
  'card_present_manual',
  'cash',
  'check',
  'other',
] as const;
export type JobFieldPaymentMethod = (typeof jobFieldPaymentMethodValues)[number];

export const jobFieldPaymentStatusValues = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'canceled',
] as const;
export type JobFieldPaymentStatus = (typeof jobFieldPaymentStatusValues)[number];

export const jobFieldPayments = pgTable(
  'job_field_payments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id').references(() => driverShifts.id, { onDelete: 'set null' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    tipCents: bigint('tip_cents', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    paymentMethod: text('payment_method', { enum: jobFieldPaymentMethodValues }).notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeTerminalReaderId: text('stripe_terminal_reader_id'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    status: text('status', { enum: jobFieldPaymentStatusValues }).notNull().default('pending'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    receiptEmail: text('receipt_email'),
    receiptUrl: text('receipt_url'),
    clientIdempotencyKey: text('client_idempotency_key'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    stripePiUnique: uniqueIndex('job_field_payments_stripe_pi_unique')
      .on(t.stripePaymentIntentId)
      .where(sql`stripe_payment_intent_id IS NOT NULL`),
    tenantIdempotencyUnique: uniqueIndex('jfp_tenant_idempotency_unique')
      .on(t.tenantId, t.clientIdempotencyKey)
      .where(sql`client_idempotency_key IS NOT NULL AND deleted_at IS NULL`),
    tenantJobCreatedIdx: index('jfp_tenant_job_created_idx').on(t.tenantId, t.jobId, t.createdAt),
    tenantDriverCreatedIdx: index('jfp_tenant_driver_created_idx').on(
      t.tenantId,
      t.driverId,
      t.createdAt,
    ),
    tenantStatusIdx: index('jfp_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type JobFieldPayment = typeof jobFieldPayments.$inferSelect;
export type NewJobFieldPayment = typeof jobFieldPayments.$inferInsert;
