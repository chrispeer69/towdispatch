/**
 * Canada Expansion (Session 47) — jurisdiction tax engine.
 *
 * Mirrors the 2026 rates seeded in 0047_canada_expansion.sql so the assertions
 * double as a guard on the engine's contract.
 */
import { describe, expect, it } from 'vitest';
import {
  type JurisdictionTaxRule,
  bpsToFraction,
  computeTax,
  selectApplicableRules,
} from '../src/modules/billing/tax.js';

const ON_HST: JurisdictionTaxRule[] = [
  { taxType: 'hst', nameEn: 'HST', nameFr: 'TVH', rateBps: 1300, displayOrder: 1 },
];
const QC_GST_QST: JurisdictionTaxRule[] = [
  { taxType: 'qst', nameEn: 'QST', nameFr: 'TVQ', rateBps: 997.5, displayOrder: 2 },
  { taxType: 'gst', nameEn: 'GST', nameFr: 'TPS', rateBps: 500, displayOrder: 1 },
];

describe('bpsToFraction', () => {
  it('treats basis points as hundredths of a percent', () => {
    expect(bpsToFraction(1300)).toBeCloseTo(0.13, 10);
    expect(bpsToFraction(997.5)).toBeCloseTo(0.09975, 10);
  });
});

describe('computeTax — single-line HST', () => {
  it('Ontario HST 13% on $100 → $13.00', () => {
    const r = computeTax(10_000, ON_HST);
    expect(r.totalTaxCents).toBe(1300);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ taxType: 'hst', name: 'HST', amountCents: 1300 });
  });

  it('localizes the tax name for fr-CA', () => {
    const r = computeTax(10_000, ON_HST, 'fr-CA');
    expect(r.lines[0]?.name).toBe('TVH');
  });
});

describe('computeTax — stacked GST + QST', () => {
  it('Quebec GST 5% + QST 9.975% on $100, GST line first, rounded per CRA', () => {
    const r = computeTax(10_000, QC_GST_QST);
    // displayOrder puts GST before QST regardless of input order.
    expect(r.lines.map((l) => l.taxType)).toEqual(['gst', 'qst']);
    expect(r.lines[0]?.amountCents).toBe(500); // GST $5.00
    expect(r.lines[1]?.amountCents).toBe(998); // QST round($9.975) = $9.98
    expect(r.totalTaxCents).toBe(1498); // $14.98
  });

  it('localizes both names for fr-CA', () => {
    const r = computeTax(10_000, QC_GST_QST, 'fr-CA');
    expect(r.lines.map((l) => l.name)).toEqual(['TPS', 'TVQ']);
  });
});

describe('computeTax — edges', () => {
  it('returns no lines and zero total when there are no rules (US path)', () => {
    const r = computeTax(10_000, []);
    expect(r.lines).toHaveLength(0);
    expect(r.totalTaxCents).toBe(0);
  });

  it('rounds a single line to the nearest cent', () => {
    // 7% PST on $99.99 = 699.93 cents → 700.
    const r = computeTax(9_999, [
      { taxType: 'pst', nameEn: 'PST', nameFr: 'TVP', rateBps: 700, displayOrder: 2 },
    ]);
    expect(r.lines[0]?.amountCents).toBe(700);
  });
});

describe('selectApplicableRules', () => {
  const at = new Date('2026-05-24T00:00:00Z');
  const rows = [
    { id: 'current', effectiveAt: new Date('2025-01-01T00:00:00Z'), expiresAt: null },
    {
      id: 'expired',
      effectiveAt: new Date('2020-01-01T00:00:00Z'),
      expiresAt: new Date('2024-01-01T00:00:00Z'),
    },
    { id: 'future', effectiveAt: new Date('2027-01-01T00:00:00Z'), expiresAt: null },
  ];

  it('keeps only rows in effect at the given instant', () => {
    const kept = selectApplicableRules(rows, at).map((r) => r.id);
    expect(kept).toEqual(['current']);
  });
});
