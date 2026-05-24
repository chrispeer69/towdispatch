/**
 * Repo Workflow (Session 49) — billing contracts.
 *
 * Repo billing is recovery-fee + skip-trace + storage + per-attempt. The API
 * turns this input into invoice_line_items via the SHARED invoice line-type
 * enum (skip_trace / repo_attempt are added there; recovery reuses 'recovery'
 * and storage reuses 'storage_daily'), then runs the existing invoices
 * computeTotals path — billing is never forked. The forwarder invoice-format
 * stubs (rdn / clearplan) are documented for S52 and not rendered here.
 */
import { z } from 'zod';

const cents = z.number().int().min(0).max(100_000_000);

export const generateRepoInvoiceSchema = z
  .object({
    // The flat recovery fee — the headline line. Required.
    recoveryFeeCents: cents,
    // Optional skip-trace investigative fee.
    skipTraceFeeCents: cents.optional(),
    // Storage reuses the S22 impound daily-rate compute (same math, different
    // cost-center): daysStored × dailyRateCents.
    storageDays: z.number().int().min(0).max(3650).optional(),
    storageDailyRateCents: cents.optional(),
    // Per-attempt fee × number of billable attempts.
    attemptFeeCents: cents.optional(),
    attemptCount: z.number().int().min(0).max(1000).optional(),
    // Tax handling mirrors the rest of billing (default non-taxable services).
    taxable: z.boolean().optional(),
    taxRatePct: z.string().optional(),
  })
  .strict();
export type GenerateRepoInvoicePayload = z.infer<typeof generateRepoInvoiceSchema>;

// A computed preview line (the API also persists these as invoice_line_items).
export const repoInvoiceLinePreviewSchema = z.object({
  lineType: z.string(),
  description: z.string(),
  quantity: z.string(),
  unitPriceCents: z.number().int(),
  lineTotalCents: z.number().int(),
});
export type RepoInvoiceLinePreviewDto = z.infer<typeof repoInvoiceLinePreviewSchema>;

export const repoInvoicePreviewSchema = z.object({
  lines: z.array(repoInvoiceLinePreviewSchema),
  subtotalCents: z.number().int(),
});
export type RepoInvoicePreviewDto = z.infer<typeof repoInvoicePreviewSchema>;
