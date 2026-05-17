/**
 * Build 5 — A/R management surface (search, reports, statements, RED ALERT).
 *
 * Two distinct DTO families:
 *
 *   1. arSearch* — the dispatcher-facing A/R workspace. Replaces the
 *      old /billing/aging page. Status filter is multi-select, the
 *      "past_due" status is computed (status='posted'/'sent' AND
 *      balance > 0 AND today >= posted_at + delinquency_days_threshold).
 *
 *   2. statementSend* / redAlertSend* — audit-trail rows written when
 *      a statement is emailed or the Monday cron fires.
 *
 * Tenant invoice defaults (default_delinquency_days, prefix, footer,
 * etc) live on tenants.settings jsonb and are exchanged via
 * tenantInvoiceDefaults*Schema below.
 */
import { z } from 'zod';
import { invoiceStatusValues, invoiceTermsValues } from './billing';

const cents = z.number().int();

// =====================================================================
// 1) A/R Search
// =====================================================================

/**
 * Multi-select status filter values. 'past_due' is COMPUTED (not a
 * real invoices.status value) — server-side it expands to invoices in
 * status IN ('issued','sent','partially_paid','overdue') with a
 * positive balance and today >= posted_at + threshold.
 *
 * 'draft' maps to invoice.status='draft'. Real invoice statuses are
 * the same enum as billing.invoiceStatusValues; 'past_due' is an
 * extra synthetic value.
 */
export const arStatusFilterValues = [
  'draft',
  'issued',
  'sent',
  'partially_paid',
  'past_due',
  'paid',
  'overdue',
  'void',
  'refunded',
] as const;
export type ArStatusFilter = (typeof arStatusFilterValues)[number];

export const arDateFieldValues = ['issued_at', 'due_at', 'created_at', 'paid_at'] as const;
export type ArDateField = (typeof arDateFieldValues)[number];

/**
 * Parse the wire-format comma-separated list (queries can't easily
 * encode arrays). Empty / undefined returns undefined; unknown
 * entries are dropped silently (the client may name a status that
 * doesn't exist in this build).
 */
export function parseArStatusesCsv(raw: string | undefined): ArStatusFilter[] | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s): s is ArStatusFilter => (arStatusFilterValues as readonly string[]).includes(s));
  return values.length > 0 ? values : undefined;
}

export function parseUuidCsv(raw: string | undefined): string[] | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return values.length > 0 ? values : undefined;
}

export const arSearchFiltersSchema = z.object({
  /** Comma-separated ArStatusFilter list. Server expands client-side via parseArStatusesCsv. */
  statuses: z.string().max(200).optional(),
  dateField: z.enum(arDateFieldValues).default('issued_at'),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  /** Customer-side fuzzy: matches customer name, account name, or invoice number. */
  q: z.string().max(120).optional(),
  /** Comma-separated account UUIDs. */
  accountIds: z.string().max(2000).optional(),
  minAmountCents: z.coerce.number().int().nonnegative().optional(),
  maxAmountCents: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  sortBy: z
    .enum(['issued_at', 'due_at', 'invoice_number', 'total_cents', 'balance_cents'])
    .default('issued_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ArSearchFilters = z.infer<typeof arSearchFiltersSchema>;

export const arSearchRowSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.enum(invoiceStatusValues),
  /** True iff this row is past the account/tenant delinquency threshold. */
  isPastDue: z.boolean(),
  /** Days past the threshold. Positive ⇔ past due; 0/negative ⇔ not yet. */
  daysOverdue: z.number().int(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),

  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  accountId: z.string().uuid().nullable(),
  accountName: z.string().nullable(),
  /** Cash / Motor Club / Direct Bill / Fleet — derived from account.isMotorClub + presence of account. */
  customerType: z.enum(['cash', 'motor_club', 'direct_bill', 'fleet']),

  jobId: z.string().uuid().nullable(),
  jobNumber: z.string().nullable(),
  driverIds: z.array(z.string().uuid()),
  driverNames: z.array(z.string()),

  subtotalCents: cents,
  taxCents: cents,
  totalCents: cents,
  paidCents: cents,
  balanceCents: cents,
});
export type ArSearchRow = z.infer<typeof arSearchRowSchema>;

export const arSearchResponseSchema = z.object({
  rows: z.array(arSearchRowSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  summary: z.object({
    invoiceCount: z.number().int().nonnegative(),
    totalBilledCents: cents,
    totalPaidCents: cents,
    totalOutstandingCents: cents,
    totalPastDueCents: cents,
  }),
});
export type ArSearchResponse = z.infer<typeof arSearchResponseSchema>;

// =====================================================================
// 2) Reports
// =====================================================================

export const arReportIdValues = [
  'aging_summary',
  'past_due_by_account',
  'revenue_summary',
  'payment_activity',
  'driver_commissions',
] as const;
export type ArReportId = (typeof arReportIdValues)[number];

export const arReportFiltersSchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  groupBy: z.enum(['account', 'customer', 'driver', 'tenant']).optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
export type ArReportFilters = z.infer<typeof arReportFiltersSchema>;

export const arReportRowSchema = z.object({
  /** Label for the grouping (account name / driver name / "Tenant total"). */
  groupLabel: z.string(),
  groupId: z.string().nullable(),
  values: z.record(z.union([z.string(), z.number(), z.null()])),
});
export type ArReportRow = z.infer<typeof arReportRowSchema>;

export const arReportResponseSchema = z.object({
  reportId: z.enum(arReportIdValues),
  generatedAt: z.string().datetime(),
  filters: z.record(z.unknown()),
  /** Ordered list of column keys + display labels, for table renderers. */
  columns: z.array(
    z.object({ key: z.string(), label: z.string(), align: z.enum(['left', 'right']).optional() }),
  ),
  rows: z.array(arReportRowSchema),
  totals: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
});
export type ArReportResponse = z.infer<typeof arReportResponseSchema>;

// =====================================================================
// 3) Statements
// =====================================================================

export const statementSendStatusValues = ['queued', 'sent', 'failed'] as const;
export type StatementSendStatus = (typeof statementSendStatusValues)[number];

export const statementPreviewSchema = z.object({
  accountId: z.string().uuid(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  invoiceFilter: z.enum(['open', 'paid', 'all']).default('all'),
});
export type StatementPreviewPayload = z.infer<typeof statementPreviewSchema>;

export const statementSendPayloadSchema = z.object({
  accountId: z.string().uuid(),
  recipientEmail: z.string().email(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  invoiceFilter: z.enum(['open', 'paid', 'all']).default('all'),
  subject: z.string().min(1).max(240).optional(),
  body: z.string().max(4000).optional(),
});
export type StatementSendPayload = z.infer<typeof statementSendPayloadSchema>;

export const statementPreviewLineSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  status: z.enum(invoiceStatusValues),
  totalCents: cents,
  paidCents: cents,
  balanceCents: cents,
});
export type StatementPreviewLine = z.infer<typeof statementPreviewLineSchema>;

export const statementPreviewResponseSchema = z.object({
  accountId: z.string().uuid(),
  accountName: z.string(),
  billingEmail: z.string().nullable(),
  asOf: z.string().datetime(),
  dateFrom: z.string().datetime().nullable(),
  dateTo: z.string().datetime().nullable(),
  invoices: z.array(statementPreviewLineSchema),
  aging: z.object({
    currentDueCents: cents,
    bucket1To30Cents: cents,
    bucket31To60Cents: cents,
    bucket61To90Cents: cents,
    bucket91PlusCents: cents,
    totalCents: cents,
  }),
});
export type StatementPreviewResponse = z.infer<typeof statementPreviewResponseSchema>;

export const statementSendDtoSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string().nullable(),
  sentTo: z.string(),
  sentAt: z.string().datetime(),
  sentBy: z.string().uuid().nullable(),
  sentByName: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  dateFrom: z.string().datetime().nullable(),
  dateTo: z.string().datetime().nullable(),
  invoiceCount: z.number().int().nonnegative(),
  totalCents: cents,
  status: z.enum(statementSendStatusValues),
});
export type StatementSendDto = z.infer<typeof statementSendDtoSchema>;

// =====================================================================
// 4) RED ALERT — Monday 6 AM past-due cron
// =====================================================================

export const redAlertSendStatusValues = ['queued', 'sent', 'failed'] as const;
export type RedAlertSendStatus = (typeof redAlertSendStatusValues)[number];

export const redAlertBreakdownAccountSchema = z.object({
  accountId: z.string().uuid(),
  accountName: z.string(),
  invoiceCount: z.number().int().nonnegative(),
  totalPastDueCents: cents,
  oldestDaysOverdue: z.number().int().nonnegative(),
});
export type RedAlertBreakdownAccount = z.infer<typeof redAlertBreakdownAccountSchema>;

export const redAlertSendDtoSchema = z.object({
  id: z.string().uuid(),
  sentAt: z.string().datetime(),
  alertForDate: z.string(),
  sentTo: z.array(z.string()),
  invoiceCount: z.number().int().nonnegative(),
  accountCount: z.number().int().nonnegative(),
  totalPastDueCents: cents,
  breakdown: z.array(redAlertBreakdownAccountSchema),
  status: z.enum(redAlertSendStatusValues),
  errorMessage: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
});
export type RedAlertSendDto = z.infer<typeof redAlertSendDtoSchema>;

// =====================================================================
// 5) Tenant Invoice Defaults — /settings/invoice-defaults
// =====================================================================

/**
 * Stored on tenants.settings jsonb. The shape is read-back-able even when
 * the tenant has never touched the form (every field defaults).
 *
 * The cron + delinquency lookup use these defaults when an account's
 * own delinquency_days_threshold is NULL. Cash customers (no account
 * on the invoice) use cashCustomerDelinquencyDays.
 */
export const tenantInvoiceDefaultsSchema = z.object({
  defaultDelinquencyDays: z.number().int().positive().default(30),
  cashCustomerDelinquencyDays: z.number().int().positive().default(7),
  defaultInvoiceTerms: z.enum(invoiceTermsValues).default('net_30'),
  invoiceNumberPrefix: z.string().max(20).default('INV-'),
  invoiceFooterText: z.string().max(4000).default(''),
  paymentInstructionsText: z.string().max(4000).default(''),
});
export type TenantInvoiceDefaults = z.infer<typeof tenantInvoiceDefaultsSchema>;

export const updateTenantInvoiceDefaultsSchema = tenantInvoiceDefaultsSchema.partial();
export type UpdateTenantInvoiceDefaultsPayload = z.infer<typeof updateTenantInvoiceDefaultsSchema>;

/**
 * The default TenantInvoiceDefaults value, used when reading an unset
 * settings blob. Mirrors the .default() chain above but cheaper than
 * .parse({}) every call.
 */
export const DEFAULT_TENANT_INVOICE_DEFAULTS: TenantInvoiceDefaults = {
  defaultDelinquencyDays: 30,
  cashCustomerDelinquencyDays: 7,
  defaultInvoiceTerms: 'net_30',
  invoiceNumberPrefix: 'INV-',
  invoiceFooterText: '',
  paymentInstructionsText: '',
};

// =====================================================================
// Helpers
// =====================================================================

/**
 * Resolve the effective delinquency days for an invoice given the
 * account (if any) and tenant invoice defaults. Used by both the A/R
 * search (computed past_due flag) and the RED ALERT cron (Monday
 * filter).
 */
export function resolveDelinquencyDays(
  accountThreshold: number | null | undefined,
  hasAccount: boolean,
  tenantDefaults: TenantInvoiceDefaults,
): number {
  if (accountThreshold != null && accountThreshold > 0) return accountThreshold;
  if (!hasAccount) return tenantDefaults.cashCustomerDelinquencyDays;
  return tenantDefaults.defaultDelinquencyDays;
}
