import { describe, expect, it } from 'vitest';
import { type FeeRow, computeBalance } from './balance-math.js';

const fee = (feeType: string, amountCents: number, deletedAt: Date | null = null): FeeRow => ({
  feeType,
  amountCents,
  deletedAt,
});

describe('computeBalance', () => {
  it('groups fee types into tow / storage / administrative / other', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 0,
      fees: [
        fee('intake', 12_500),
        fee('daily_storage', 4_000),
        fee('daily_storage', 4_000),
        fee('administrative', 2_500),
        fee('lien_processing', 7_500),
        fee('gate', 1_000),
        fee('other', 500),
      ],
    });
    expect(b.towChargesCents).toBe(12_500);
    expect(b.storageChargesCents).toBe(8_000);
    expect(b.administrativeFeesCents).toBe(2_500 + 7_500 + 1_000);
    expect(b.otherFeesCents).toBe(500);
    expect(b.totalCents).toBe(12_500 + 8_000 + 11_000 + 500);
  });

  it('ignores soft-deleted fee rows', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 0,
      fees: [fee('intake', 10_000), fee('intake', 9_999, new Date())],
    });
    expect(b.towChargesCents).toBe(10_000);
    expect(b.totalCents).toBe(10_000);
  });

  it('subtracts paid and never goes negative', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 30_000,
      fees: [fee('daily_storage', 20_000)],
    });
    expect(b.balanceCents).toBe(0);
    expect(b.paidCents).toBe(30_000);
  });

  it('balance = total - paid', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 5_000,
      fees: [fee('daily_storage', 20_000)],
    });
    expect(b.balanceCents).toBe(15_000);
  });

  it('treats an unknown fee type as other (conservative, never dropped)', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 0,
      fees: [fee('mystery_surcharge', 1_234)],
    });
    expect(b.otherFeesCents).toBe(1_234);
    expect(b.totalCents).toBe(1_234);
  });

  it('emits one line per non-zero fee type, sorted, with labels', () => {
    const b = computeBalance({
      impoundId: 'imp-1',
      paidCents: 0,
      fees: [fee('daily_storage', 4_000), fee('intake', 12_500)],
    });
    expect(b.lines).toEqual([
      { feeType: 'daily_storage', label: 'Storage (to date)', amountCents: 4_000 },
      { feeType: 'intake', label: 'Tow / intake', amountCents: 12_500 },
    ]);
  });

  it('empty ledger → zero balance, no lines', () => {
    const b = computeBalance({ impoundId: 'imp-1', paidCents: 0, fees: [] });
    expect(b.totalCents).toBe(0);
    expect(b.lines).toEqual([]);
  });
});
