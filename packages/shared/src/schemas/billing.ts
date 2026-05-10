/**
 * Billing module contracts — Session 10.
 *
 * The full invoice/payment/credit-memo/aging surface for the API and web app.
 * Money is integer cents everywhere; quantity / tax-rate-percent are numeric
 * strings (Postgres NUMERIC) so float drift cannot creep in at the wire.
 */
import { z } from 'zod';

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
  'admin',
  'discount',
  'custom',
] as const;
export type InvoiceLineItemType = (typeof invoiceLineItemTypeValues)[number];

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

export const creditMemoReasonValues = [
  'refund',
  'billing_error',
  'service_failure',
  'goodwill',
  'other',
] as const;
export type CreditMemoReason = (typeof creditMemoReasonValues)[number];

export const creditMemoApplicationValues = ['apply_to_invoice', 'customer_credit'] as const;
export type CreditMemoApplication = (typeof creditMemoApplicationValues)[number];

const cents = z.number().int();
const nonnegCents = z.number().int().nonnegative();
const quantitySchema = z.union([z.number().nonnegative(), z.string().regex(/^-?\d+(\.\d+)?$/)]);

const billingAddressSchema = z
  .object({
    name: z.string().max(240).optional().nullable(),
    street: z.string().max(240).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(40).optional().nullable(),
    zip: z.string().max(20).optional().nullable(),
    country: z.string().max(40).optional().nullable(),
    email: z.string().email().max(254).optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
  })
  .partial()
  .nullable();
export type InvoiceBillingAddress = z.infer<typeof billingAddressSchema>;

export const invoiceLineItemDtoSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  lineNumber: z.number().int().positive(),
  lineType: z.enum(invoiceLineItemTypeValues),
  description: z.string(),
  quantity: z.string(),
  unit: z.string(),
  unitPriceCents: cents,
  lineTotalCents: cents,
  taxable: z.boolean(),
  taxRatePct: z.string(),
  rateRuleId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InvoiceLineItemDto = z.infer<typeof invoiceLineItemDtoSchema>;

export const invoiceTaxDtoSchema = z.object({
  id: z.string().uuid(),
  taxJurisdiction: z.string(),
  taxName: z.string(),
  taxRatePct: z.string(),
  taxableAmountCents: nonnegCents,
  taxAmountCents: nonnegCents,
});
export type InvoiceTaxDto = z.infer<typeof invoiceTaxDtoSchema>;

export const paymentDtoSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amountCents: cents,
  paymentMethod: z.enum(paymentMethodValues),
  referenceNumber: z.string().nullable(),
  receivedAt: z.string().datetime(),
  recordedBy: z.string().uuid().nullable(),
  status: z.enum(paymentStatusValues),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;

export const invoiceDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  invoiceNumber: z.string(),
  invoiceType: z.enum(invoiceTypeValues),
  status: z.enum(invoiceStatusValues),
  customerId: z.string().uuid().nullable(),
  accountId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  rateSheetId: z.string().uuid().nullable(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  voidedAt: z.string().datetime().nullable(),
  subtotalCents: nonnegCents,
  taxCents: nonnegCents,
  totalCents: nonnegCents,
  paidCents: cents,
  balanceCents: cents,
  currency: z.string(),
  terms: z.enum(invoiceTermsValues),
  notes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  billingAddress: billingAddressSchema.nullable(),
  voidReason: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InvoiceDto = z.infer<typeof invoiceDtoSchema>;

export const invoiceWithDetailsSchema = invoiceDtoSchema.extend({
  lineItems: z.array(invoiceLineItemDtoSchema),
  taxes: z.array(invoiceTaxDtoSchema),
  payments: z.array(paymentDtoSchema),
});
export type InvoiceWithDetailsDto = z.infer<typeof invoiceWithDetailsSchema>;

// ----------------- request schemas -----------------

export const createInvoiceLineItemSchema = z.object({
  lineType: z.enum(invoiceLineItemTypeValues).default('custom'),
  description: z.string().min(1).max(500),
  quantity: quantitySchema.default(1),
  unit: z.string().min(1).max(40).default('each'),
  unitPriceCents: cents,
  taxable: z.boolean().default(false),
  taxRatePct: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)]).default(0),
  rateRuleId: z.string().max(120).nullable().optional(),
});
export type CreateInvoiceLineItemPayload = z.infer<typeof createInvoiceLineItemSchema>;

export const createInvoiceSchema = z.object({
  invoiceType: z.enum(invoiceTypeValues).default('manual'),
  customerId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  terms: z.enum(invoiceTermsValues).default('net_30'),
  notes: z.string().max(2000).optional().nullable(),
  internalNotes: z.string().max(2000).optional().nullable(),
  billingAddress: billingAddressSchema.optional(),
  lineItems: z.array(createInvoiceLineItemSchema).default([]),
});
export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  terms: z.enum(invoiceTermsValues).optional(),
  notes: z.string().max(2000).optional().nullable(),
  internalNotes: z.string().max(2000).optional().nullable(),
  billingAddress: billingAddressSchema.optional(),
});
export type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidInvoicePayload = z.infer<typeof voidInvoiceSchema>;

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: cents.refine((n: number) => n !== 0, 'amount must not be zero'),
  paymentMethod: z.enum(paymentMethodValues),
  referenceNumber: z.string().max(120).optional().nullable(),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(paymentStatusValues).optional(),
});
export type RecordPaymentPayload = z.infer<typeof recordPaymentSchema>;

export const createCreditMemoSchema = z.object({
  originalInvoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reasonCode: z.enum(creditMemoReasonValues),
  reason: z.string().min(1).max(500),
  appliedTo: z.enum(creditMemoApplicationValues).default('apply_to_invoice'),
});
export type CreateCreditMemoPayload = z.infer<typeof createCreditMemoSchema>;

export const createRecurringScheduleSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  description: z.string().min(1).max(240),
  dailyRateCents: z.number().int().positive(),
  startedAt: z.string().datetime(),
});
export type CreateRecurringSchedulePayload = z.infer<typeof createRecurringScheduleSchema>;

export const invoiceFiltersSchema = z.object({
  status: z.enum(invoiceStatusValues).optional(),
  invoiceType: z.enum(invoiceTypeValues).optional(),
  customerId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  /** ISO date — inclusive lower bound on issued_at. */
  issuedFrom: z.string().datetime().optional(),
  issuedTo: z.string().datetime().optional(),
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>;

export const paymentFiltersSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  paymentMethod: z.enum(paymentMethodValues).optional(),
  receivedFrom: z.string().datetime().optional(),
  receivedTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type PaymentFilters = z.infer<typeof paymentFiltersSchema>;

export const agingFiltersSchema = z.object({
  accountId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  /** ISO date — anchor for aging calculation. Defaults to now() server-side. */
  asOf: z.string().datetime().optional(),
});
export type AgingFilters = z.infer<typeof agingFiltersSchema>;

export const agingRowSchema = z.object({
  accountId: z.string().uuid().nullable(),
  accountName: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  currentDueCents: cents,
  bucket1To30Cents: cents,
  bucket31To60Cents: cents,
  bucket61To90Cents: cents,
  bucket91PlusCents: cents,
  totalCents: cents,
  oldestDueAt: z.string().datetime().nullable(),
  invoiceCount: z.number().int().nonnegative(),
});
export type AgingRow = z.infer<typeof agingRowSchema>;

export const agingResponseSchema = z.object({
  asOf: z.string().datetime(),
  rows: z.array(agingRowSchema),
  totals: z.object({
    currentDueCents: cents,
    bucket1To30Cents: cents,
    bucket31To60Cents: cents,
    bucket61To90Cents: cents,
    bucket91PlusCents: cents,
    totalCents: cents,
    invoiceCount: z.number().int().nonnegative(),
  }),
});
export type AgingResponse = z.infer<typeof agingResponseSchema>;

export const creditMemoDtoSchema = z.object({
  id: z.string().uuid(),
  memoNumber: z.string(),
  originalInvoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reasonCode: z.enum(creditMemoReasonValues),
  reason: z.string(),
  appliedTo: z.enum(creditMemoApplicationValues),
  issuedAt: z.string().datetime(),
  issuedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type CreditMemoDto = z.infer<typeof creditMemoDtoSchema>;

export const recurringScheduleDtoSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  accountId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  description: z.string(),
  dailyRateCents: z.number().int().positive(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  lastInvoicedThrough: z.string().datetime().nullable(),
  nextInvoiceAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type RecurringScheduleDto = z.infer<typeof recurringScheduleDtoSchema>;

/**
 * Translate an account billing_terms enum to the invoice terms enum. Identical
 * values today; helper exists so the mapping is greppable when terms diverge.
 */
export function termsFromAccountBilling(
  accountTerms: 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'cod' | 'prepay' | string,
): InvoiceTerms {
  switch (accountTerms) {
    case 'net_15':
      return 'net_15';
    case 'net_30':
      return 'net_30';
    case 'net_45':
      return 'net_45';
    case 'net_60':
      return 'net_60';
    case 'cod':
      return 'cod';
    case 'prepay':
      return 'prepay';
    default:
      return 'net_30';
  }
}

export function dueDaysForTerms(terms: InvoiceTerms): number {
  switch (terms) {
    case 'due_on_receipt':
    case 'cod':
    case 'prepay':
      return 0;
    case 'net_15':
      return 15;
    case 'net_30':
      return 30;
    case 'net_45':
      return 45;
    case 'net_60':
      return 60;
    default:
      return 30;
  }
}

/** Friendly labels for status / type / method enums used across UI surfaces. */
export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
  refunded: 'Refunded',
};

export const invoiceTypeLabel: Record<InvoiceType, string> = {
  cash_receipt: 'Cash receipt',
  account_invoice: 'Account invoice',
  motor_club_submission: 'Motor club submission',
  recurring_storage: 'Recurring storage',
  manual: 'Manual invoice',
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit card',
  ach: 'ACH',
  account_credit: 'Account credit',
  motor_club_remittance: 'Motor club remittance',
  write_off: 'Write-off',
};
