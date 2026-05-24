/**
 * invoices — Session 10, the billing module.
 *
 * The invoice is the customer-facing settlement of a job (or a manual ad-hoc
 * billing event). Every numeric money field is integer cents — never floats.
 * Per-tenant invoice_number sequencing mirrors jobs.job_number: a small
 * sequences table allocated under transaction with UPSERT + UPDATE … RETURNING
 * so concurrent issue requests cannot collide.
 *
 *   draft → issued → (partially_paid) → paid
 *           issued → overdue (cron, when due_at < now)
 *           any   → void   (admin only)
 *           paid  → refunded (when a credit memo / refund is applied)
 *
 * Source FK columns are intentionally generous:
 *   - customer_id : nullable for cash receipts written without a captured
 *                   contact (walk-up tow with a credit card swipe).
 *   - account_id  : nullable for cash invoices and motor club submissions
 *                   that piggyback on a customer not an account.
 *   - job_id      : nullable so manual / recurring storage invoices can exist
 *                   without a backing job.
 *
 * billing_address, snapshotted on issue, captures the bill-to block at the
 * moment of issue rather than re-deriving from the customer/account on every
 * render — addresses change.
 *
 * FORCE RLS, audit trigger, tenant_id NOT NULL. SQL: see 0013_billing.sql.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { customers } from './customers';
import { jobs } from './jobs';
import { rateSheets } from './rate-sheets';
import { tenants } from './tenants';
import { users } from './users';

export const invoiceTypeValues = [
  'cash_receipt',
  'account_invoice',
  'motor_club_submission',
  'recurring_storage',
  'manual',
] as const;
export type InvoiceType = (typeof invoiceTypeValues)[number];

export const invoiceStatusValues = [
  'draft',
  'issued',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
  'refunded',
] as const;
export type InvoiceStatus = (typeof invoiceStatusValues)[number];

export const invoiceTermsValues = [
  'due_on_receipt',
  'net_15',
  'net_30',
  'net_45',
  'net_60',
  'cod',
  'prepay',
] as const;
export type InvoiceTerms = (typeof invoiceTermsValues)[number];

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    invoiceNumber: text('invoice_number').notNull(),

    invoiceType: text('invoice_type', { enum: invoiceTypeValues }).notNull().default('manual'),
    status: text('status', { enum: invoiceStatusValues }).notNull().default('draft'),

    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    rateSheetId: uuid('rate_sheet_id').references(() => rateSheets.id, { onDelete: 'set null' }),

    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),

    subtotalCents: bigint('subtotal_cents', { mode: 'number' }).notNull().default(0),
    taxCents: bigint('tax_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
    paidCents: bigint('paid_cents', { mode: 'number' }).notNull().default(0),
    balanceCents: bigint('balance_cents', { mode: 'number' }).notNull().default(0),

    currency: text('currency').notNull().default('USD'),
    terms: text('terms', { enum: invoiceTermsValues }).notNull().default('net_30'),

    notes: text('notes'),
    /** Internal-only — never rendered on the customer-facing PDF. */
    internalNotes: text('internal_notes'),

    /** Snapshot of the bill-to address at issue time. */
    billingAddress: jsonb('billing_address'),

    /** Cause when status = void. Required by the void endpoint. */
    voidReason: text('void_reason'),

    /** Public payment token — drives /pay/[token]. Unique per tenant. */
    paymentToken: text('payment_token'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantInvoiceNumberUnique: uniqueIndex('invoices_tenant_invoice_number_unique').on(
      t.tenantId,
      t.invoiceNumber,
    ),
    tenantStatusIdx: index('invoices_tenant_status_idx').on(t.tenantId, t.status),
    tenantCustomerIdx: index('invoices_tenant_customer_idx').on(t.tenantId, t.customerId),
    tenantAccountIdx: index('invoices_tenant_account_idx').on(t.tenantId, t.accountId),
    tenantJobIdx: index('invoices_tenant_job_idx').on(t.tenantId, t.jobId),
    tenantDueIdx: index('invoices_tenant_due_idx').on(t.tenantId, t.dueAt),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

/**
 * invoice_number_sequences — per-tenant per-year sequence allocator.
 * Mirror of job_number_sequences. Compound primary key (tenant_id, year_key)
 * makes the UPSERT conflict target safe under contention.
 */
export const invoiceNumberSequences = pgTable(
  'invoice_number_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    yearKey: text('year_key').notNull(),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantYearUnique: uniqueIndex('invoice_number_sequences_tenant_year_unique').on(
      t.tenantId,
      t.yearKey,
    ),
  }),
);

export type InvoiceNumberSequence = typeof invoiceNumberSequences.$inferSelect;
export type NewInvoiceNumberSequence = typeof invoiceNumberSequences.$inferInsert;

export const invoiceLineItemTypeValues = [
  'service',
  'mileage_loaded',
  'mileage_unloaded',
  'wait_time',
  'winch',
  'recovery',
  'after_hours',
  'equipment_surcharge',
  'environmental',
  'storage_daily',
  // Repossession Workflow (Session 49) — repo-specific line types.
  'skip_trace',
  'repo_attempt',
  'admin',
  'discount',
  'custom',
] as const;
export type InvoiceLineItemType = (typeof invoiceLineItemTypeValues)[number];

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),

    lineNumber: integer('line_number').notNull(),
    lineType: text('line_type', { enum: invoiceLineItemTypeValues }).notNull().default('custom'),

    description: text('description').notNull(),
    /** numeric so 1.25 mile / 0.5 hour quantities round-trip cleanly. */
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
    unit: text('unit').notNull().default('each'),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull().default(0),
    lineTotalCents: bigint('line_total_cents', { mode: 'number' }).notNull().default(0),

    taxable: boolean('taxable').notNull().default(false),
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 4 }).notNull().default('0'),

    /** Captures the rate engine rule code that produced this line, if any. */
    rateRuleId: text('rate_rule_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantInvoiceIdx: index('invoice_line_items_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    invoiceLineUnique: uniqueIndex('invoice_line_items_invoice_line_unique').on(
      t.invoiceId,
      t.lineNumber,
    ),
  }),
);

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;

export const invoiceTaxes = pgTable(
  'invoice_taxes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    taxJurisdiction: text('tax_jurisdiction').notNull(),
    taxName: text('tax_name').notNull(),
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 4 }).notNull(),
    taxableAmountCents: bigint('taxable_amount_cents', { mode: 'number' }).notNull(),
    taxAmountCents: bigint('tax_amount_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantInvoiceIdx: index('invoice_taxes_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
  }),
);

export type InvoiceTax = typeof invoiceTaxes.$inferSelect;
export type NewInvoiceTax = typeof invoiceTaxes.$inferInsert;

export const paymentMethodValues = [
  'cash',
  'check',
  'credit_card',
  'ach',
  'account_credit',
  'motor_club_remittance',
  'write_off',
] as const;
export type PaymentMethod = (typeof paymentMethodValues)[number];

export const paymentStatusValues = ['pending', 'cleared', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof paymentStatusValues)[number];

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),

    /** Negative payments are valid (refunds / write-off reversals). */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    paymentMethod: text('payment_method', { enum: paymentMethodValues }).notNull(),
    /** Check #, ACH ref, motor club case #, last4 for credit cards. */
    referenceNumber: text('reference_number'),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),

    status: text('status', { enum: paymentStatusValues }).notNull().default('cleared'),
    notes: text('notes'),

    // Session 11 — Stripe linkage.
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeChargeId: text('stripe_charge_id'),
    stripeRefundId: text('stripe_refund_id'),
    /** Margin we kept on top of Stripe's fees (basis points × amount). */
    platformMarginCents: bigint('platform_margin_cents', { mode: 'number' }).notNull().default(0),
    /** Stripe's processing fee (informational — for net-payout reporting). */
    stripeFeeCents: bigint('stripe_fee_cents', { mode: 'number' }).notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantInvoiceIdx: index('payments_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    tenantReceivedIdx: index('payments_tenant_received_idx').on(t.tenantId, t.receivedAt),
    tenantMethodIdx: index('payments_tenant_method_idx').on(t.tenantId, t.paymentMethod),
  }),
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export const creditMemoReasonValues = [
  'refund',
  'billing_error',
  'service_failure',
  'goodwill',
  'other',
] as const;
export type CreditMemoReason = (typeof creditMemoReasonValues)[number];

export const creditMemos = pgTable(
  'credit_memos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    memoNumber: text('memo_number').notNull(),
    /** The invoice the memo applies against. */
    originalInvoiceId: uuid('original_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),

    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    reasonCode: text('reason_code', { enum: creditMemoReasonValues }).notNull().default('other'),
    reason: text('reason').notNull(),

    /**
     * 'apply_to_invoice' reduces the original invoice's balance directly
     * (creates an offsetting payment row of method=write_off). 'customer_credit'
     * banks the credit against the customer for future invoice application.
     */
    appliedTo: text('applied_to', { enum: ['apply_to_invoice', 'customer_credit'] as const })
      .notNull()
      .default('apply_to_invoice'),

    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantInvoiceIdx: index('credit_memos_tenant_invoice_idx').on(t.tenantId, t.originalInvoiceId),
    tenantMemoNumberUnique: uniqueIndex('credit_memos_tenant_memo_number_unique').on(
      t.tenantId,
      t.memoNumber,
    ),
  }),
);

export type CreditMemo = typeof creditMemos.$inferSelect;
export type NewCreditMemo = typeof creditMemos.$inferInsert;

/**
 * recurring_billing_schedules — drives the monthly storage invoice generation
 * for impound vehicles. Emitted to BullMQ from a daily tick. last_invoiced_through
 * advances on every cycle so we never double-bill a day.
 */
export const recurringBillingSchedules = pgTable(
  'recurring_billing_schedules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    /** Job that started the impound (nullable for ad-hoc storage billings). */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),

    description: text('description').notNull(),
    dailyRateCents: bigint('daily_rate_cents', { mode: 'number' }).notNull(),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    lastInvoicedThrough: timestamp('last_invoiced_through', { withTimezone: true }),
    nextInvoiceAt: timestamp('next_invoice_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('recurring_billing_schedules_tenant_active_idx').on(
      t.tenantId,
      t.endedAt,
    ),
    tenantNextIdx: index('recurring_billing_schedules_tenant_next_idx').on(
      t.tenantId,
      t.nextInvoiceAt,
    ),
  }),
);

export type RecurringBillingSchedule = typeof recurringBillingSchedules.$inferSelect;
export type NewRecurringBillingSchedule = typeof recurringBillingSchedules.$inferInsert;
