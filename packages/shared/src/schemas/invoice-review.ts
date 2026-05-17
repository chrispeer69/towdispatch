/**
 * Invoice Review contracts — Admin Settings build 4 of 6.
 *
 * The Review screen is the dispatcher's two-section page rendered for a
 * draft invoice generated from a completed job. The top section edits
 * the customer invoice (line items, totals). The bottom section
 * allocates per-line driver commissions. A single Post button commits
 * both atomically.
 *
 * The DTOs here are the wire shape returned by GET /invoices/:id/review
 * and consumed by PATCH /invoices/:id/review.
 *
 * Driver visibility wall: InvoiceLineCommissionDto must NEVER appear in
 * driver-facing endpoints. The wall is enforced at the API layer; this
 * schema only describes the shape used by dispatcher/admin clients.
 */
import { z } from 'zod';
import { invoiceDtoSchema, invoiceLineItemDtoSchema, invoiceTaxDtoSchema } from './billing';

const cents = z.number().int();
const nonnegCents = z.number().int().nonnegative();
/** numeric(5,2) on the wire. Use number for ergonomics, refine to two decimals. */
const commissionPctSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.round(n * 100) === n * 100, 'commission_pct supports at most 2 decimals');

export const invoiceLineCommissionDtoSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  invoiceLineItemId: z.string().uuid(),
  driverId: z.string().uuid(),
  /** Joined for display. */
  driverName: z.string(),
  commissionPct: commissionPctSchema,
  commissionAmountCents: nonnegCents,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InvoiceLineCommissionDto = z.infer<typeof invoiceLineCommissionDtoSchema>;

export const driverSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  defaultCommissionPct: z.number().min(0).max(100).nullable(),
});
export type DriverSummaryDto = z.infer<typeof driverSummaryDtoSchema>;

export const customerSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type CustomerSummaryDto = z.infer<typeof customerSummaryDtoSchema>;

export const accountSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type AccountSummaryDto = z.infer<typeof accountSummaryDtoSchema>;

export const reviewJobSummarySchema = z.object({
  id: z.string().uuid(),
  jobNumber: z.string(),
  completedAt: z.string().datetime().nullable(),
});
export type ReviewJobSummaryDto = z.infer<typeof reviewJobSummarySchema>;

export const invoiceReviewDtoSchema = z.object({
  invoice: invoiceDtoSchema,
  lineItems: z.array(invoiceLineItemDtoSchema),
  taxes: z.array(invoiceTaxDtoSchema),
  commissions: z.array(invoiceLineCommissionDtoSchema),
  assignedDrivers: z.array(driverSummaryDtoSchema),
  job: reviewJobSummarySchema.nullable(),
  customer: customerSummaryDtoSchema.nullable(),
  account: accountSummaryDtoSchema.nullable(),
});
export type InvoiceReviewDto = z.infer<typeof invoiceReviewDtoSchema>;

// ----- PATCH payload -----

export const updateInvoiceReviewLineSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1).max(500).optional(),
  /** Numeric quantity; numeric(14,4) at the DB. */
  quantity: z.union([z.number().nonnegative(), z.string().regex(/^-?\d+(\.\d+)?$/)]).optional(),
  unit: z.string().min(1).max(40).optional(),
  unitPriceCents: cents.optional(),
  /** Optional explicit override — server otherwise computes from qty × unit. */
  lineTotalCents: cents.optional(),
  taxable: z.boolean().optional(),
  taxRatePct: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
});
export type UpdateInvoiceReviewLine = z.infer<typeof updateInvoiceReviewLineSchema>;

export const updateInvoiceReviewCommissionSchema = z.object({
  lineItemId: z.string().uuid(),
  driverId: z.string().uuid(),
  commissionPct: commissionPctSchema,
});
export type UpdateInvoiceReviewCommission = z.infer<typeof updateInvoiceReviewCommissionSchema>;

export const updateInvoiceReviewPayloadSchema = z.object({
  /** Edits to existing draft lines. New rows must use the line-items endpoint. */
  lineItems: z.array(updateInvoiceReviewLineSchema).optional(),
  /**
   * Full replacement of commission allocations. The set you send overwrites
   * the stored set for *referenced lines only*; lines you omit are untouched.
   * Use an empty array of commissions for a given lineItemId to clear it.
   */
  commissions: z.array(updateInvoiceReviewCommissionSchema).optional(),
  /** Customer-visible notes. Maps to invoices.notes. */
  notes: z.string().max(2000).optional().nullable(),
  /** Internal-only notes; never on the customer PDF. */
  internalNotes: z.string().max(2000).optional().nullable(),
  /** Optional set of driver IDs to ensure are assigned to the job. */
  assignedDriverIds: z.array(z.string().uuid()).optional(),
});
export type UpdateInvoiceReviewPayload = z.infer<typeof updateInvoiceReviewPayloadSchema>;

// ----- POST payload (post invoice) -----

export const postInvoiceResponseSchema = z.object({
  invoice: invoiceDtoSchema,
  commissions: z.array(invoiceLineCommissionDtoSchema),
});
export type PostInvoiceResponse = z.infer<typeof postInvoiceResponseSchema>;

// ----- assign driver to job -----

export const assignJobDriverSchema = z.object({
  driverId: z.string().uuid(),
  role: z.string().min(1).max(40).optional(),
});
export type AssignJobDriverPayload = z.infer<typeof assignJobDriverSchema>;
