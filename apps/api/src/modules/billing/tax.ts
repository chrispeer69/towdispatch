/**
 * Tax engine (Canada Expansion, Session 47).
 *
 * `computeTax` is a pure function: given a taxable base in cents and the set of
 * tax rules that apply to a jurisdiction, it returns one line per rule plus the
 * rounded total. It is currency-agnostic (cents in, cents out) and locale-aware
 * only for the displayed tax NAME (HST vs TVH).
 *
 * Canada produces multi-line tax — a single HST line, or a GST line stacked
 * with a provincial PST/QST line. The US keeps its existing single per-line
 * sales-tax model (see InvoicesService.recomputeTotals); this engine is invoked
 * only when the tenant's country resolves to a multi-line jurisdiction.
 *
 * Rounding follows CRA practice: each tax component is rounded to the cent
 * independently (GST and QST are each rounded against the same base, not the
 * running total). Quebec example — $100 base: GST 5% = $5.00, QST 9.975% =
 * round($9.975) = $9.98, total $14.98.
 *
 * rateBps is basis points (1% = 100 bps). It may be fractional: QST is 9.975%
 * = 997.5 bps. The fraction is bps / 10_000.
 */
import type { SupportedLocale } from '@ustowdispatch/shared';

export interface JurisdictionTaxRule {
  taxType: string; // gst | hst | pst | qst | sales_tax
  nameEn: string;
  nameFr: string;
  rateBps: number;
  displayOrder: number;
}

export interface ComputedTaxLine {
  taxType: string;
  /** Tax name localized for the supplied locale (English unless fr-*). */
  name: string;
  rateBps: number;
  taxableCents: number;
  amountCents: number;
}

export interface ComputedTax {
  lines: ComputedTaxLine[];
  totalTaxCents: number;
}

/** Convert basis points to a multiplier fraction (1300 bps → 0.13). */
export function bpsToFraction(bps: number): number {
  return bps / 10_000;
}

/**
 * Filter a jurisdiction's full rule history down to those in effect at `at`.
 * Base rules carry effective_at <= at and (expires_at IS NULL OR expires_at > at).
 */
export function selectApplicableRules<T extends { effectiveAt: Date; expiresAt: Date | null }>(
  rules: T[],
  at: Date,
): T[] {
  return rules.filter(
    (r) =>
      r.effectiveAt.getTime() <= at.getTime() &&
      (r.expiresAt === null || r.expiresAt.getTime() > at.getTime()),
  );
}

/**
 * Compute tax lines for a taxable base. Lines are ordered by displayOrder
 * (GST before the provincial component), then taxType for determinism.
 */
export function computeTax(
  taxableCents: number,
  rules: JurisdictionTaxRule[],
  locale: SupportedLocale = 'en-CA',
): ComputedTax {
  const french = locale.startsWith('fr');
  const lines: ComputedTaxLine[] = [...rules]
    .sort((a, b) => a.displayOrder - b.displayOrder || a.taxType.localeCompare(b.taxType))
    .map((r) => ({
      taxType: r.taxType,
      name: french ? r.nameFr : r.nameEn,
      rateBps: r.rateBps,
      taxableCents,
      amountCents: Math.round(taxableCents * bpsToFraction(r.rateBps)),
    }));
  const totalTaxCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return { lines, totalTaxCents };
}
