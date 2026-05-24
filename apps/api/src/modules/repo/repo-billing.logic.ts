/**
 * Pure repo billing math. Turns a GenerateRepoInvoicePayload into invoice
 * line items, deterministically. No I/O — unit-tested directly; the service
 * persists the result through the existing invoices computeTotals path.
 *
 * Line-type mapping (shared InvoiceLineItemType):
 *   recovery fee   -> 'recovery'       (reuses the existing recovery line)
 *   skip-trace fee -> 'skip_trace'     (repo-specific)
 *   storage        -> 'storage_daily'  (reuses the S22 impound daily-rate math
 *                                       — same compute, different cost-center)
 *   per-attempt    -> 'repo_attempt'   (repo-specific)
 */
import type { GenerateRepoInvoicePayload, InvoiceLineItemType } from '@ustowdispatch/shared';

export interface RepoBillingLine {
  lineType: InvoiceLineItemType;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  lineTotalCents: number;
  taxable: boolean;
  taxRatePct: string;
}

const DEFAULT_TAX_RATE = '0';

/**
 * Compute the repo invoice lines. The recovery fee is always emitted (even if
 * zero — the invoice should show the headline line). Optional fees are emitted
 * only when both their amount and (for storage/attempts) their count are
 * positive, so a $0 skip-trace doesn't clutter the invoice.
 */
export function computeRepoBillingLines(input: GenerateRepoInvoicePayload): RepoBillingLine[] {
  const taxable = input.taxable ?? false;
  const taxRatePct = input.taxRatePct ?? DEFAULT_TAX_RATE;
  const lines: RepoBillingLine[] = [];

  lines.push({
    lineType: 'recovery',
    description: 'Repossession recovery fee',
    quantity: '1',
    unit: 'each',
    unitPriceCents: input.recoveryFeeCents,
    lineTotalCents: input.recoveryFeeCents,
    taxable,
    taxRatePct,
  });

  if (input.skipTraceFeeCents && input.skipTraceFeeCents > 0) {
    lines.push({
      lineType: 'skip_trace',
      description: 'Skip-trace / investigative fee',
      quantity: '1',
      unit: 'each',
      unitPriceCents: input.skipTraceFeeCents,
      lineTotalCents: input.skipTraceFeeCents,
      taxable,
      taxRatePct,
    });
  }

  const storageDays = input.storageDays ?? 0;
  const storageRate = input.storageDailyRateCents ?? 0;
  if (storageDays > 0 && storageRate > 0) {
    lines.push({
      lineType: 'storage_daily',
      description: 'Recovery storage',
      quantity: String(storageDays),
      unit: 'day',
      unitPriceCents: storageRate,
      lineTotalCents: storageDays * storageRate,
      taxable,
      taxRatePct,
    });
  }

  const attemptCount = input.attemptCount ?? 0;
  const attemptFee = input.attemptFeeCents ?? 0;
  if (attemptCount > 0 && attemptFee > 0) {
    lines.push({
      lineType: 'repo_attempt',
      description: 'Recovery attempts',
      quantity: String(attemptCount),
      unit: 'attempt',
      unitPriceCents: attemptFee,
      lineTotalCents: attemptCount * attemptFee,
      taxable,
      taxRatePct,
    });
  }

  return lines;
}

export function sumRepoBillingCents(lines: RepoBillingLine[]): number {
  return lines.reduce((acc, l) => acc + l.lineTotalCents, 0);
}
