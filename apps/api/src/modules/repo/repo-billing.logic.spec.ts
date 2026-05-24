/**
 * Unit coverage for repo billing line computation (Session 49). Verifies the
 * line-type mapping, the optional-fee gating, quantity×rate totals, and the
 * subtotal — the math that feeds the existing invoices computeTotals path.
 */
import { describe, expect, it } from 'vitest';
import { computeRepoBillingLines, sumRepoBillingCents } from './repo-billing.logic.js';

describe('computeRepoBillingLines', () => {
  it('always emits the recovery fee as the first line', () => {
    const lines = computeRepoBillingLines({ recoveryFeeCents: 35000 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineType: 'recovery',
      quantity: '1',
      unitPriceCents: 35000,
      lineTotalCents: 35000,
    });
  });

  it('emits skip-trace, storage, and per-attempt lines when present', () => {
    const lines = computeRepoBillingLines({
      recoveryFeeCents: 35000,
      skipTraceFeeCents: 5000,
      storageDays: 4,
      storageDailyRateCents: 2500,
      attemptFeeCents: 1000,
      attemptCount: 3,
    });
    const byType = Object.fromEntries(lines.map((l) => [l.lineType, l]));
    expect(byType.recovery?.lineTotalCents).toBe(35000);
    expect(byType.skip_trace?.lineTotalCents).toBe(5000);
    expect(byType.storage_daily).toMatchObject({ quantity: '4', lineTotalCents: 10000 });
    expect(byType.repo_attempt).toMatchObject({ quantity: '3', lineTotalCents: 3000 });
    expect(sumRepoBillingCents(lines)).toBe(35000 + 5000 + 10000 + 3000);
  });

  it('omits storage when days or rate is zero', () => {
    expect(
      computeRepoBillingLines({
        recoveryFeeCents: 100,
        storageDays: 0,
        storageDailyRateCents: 2500,
      }),
    ).toHaveLength(1);
    expect(
      computeRepoBillingLines({ recoveryFeeCents: 100, storageDays: 5, storageDailyRateCents: 0 }),
    ).toHaveLength(1);
  });

  it('omits per-attempt billing when count or fee is zero', () => {
    expect(
      computeRepoBillingLines({ recoveryFeeCents: 100, attemptCount: 0, attemptFeeCents: 1000 }),
    ).toHaveLength(1);
    expect(
      computeRepoBillingLines({ recoveryFeeCents: 100, attemptCount: 3, attemptFeeCents: 0 }),
    ).toHaveLength(1);
  });

  it('omits a zero skip-trace fee', () => {
    expect(computeRepoBillingLines({ recoveryFeeCents: 100, skipTraceFeeCents: 0 })).toHaveLength(
      1,
    );
  });

  it('propagates taxable / taxRatePct onto every line', () => {
    const lines = computeRepoBillingLines({
      recoveryFeeCents: 100,
      skipTraceFeeCents: 50,
      taxable: true,
      taxRatePct: '7.5',
    });
    expect(lines.every((l) => l.taxable && l.taxRatePct === '7.5')).toBe(true);
  });

  it('defaults to non-taxable at 0% when omitted', () => {
    const [line] = computeRepoBillingLines({ recoveryFeeCents: 100 });
    expect(line).toMatchObject({ taxable: false, taxRatePct: '0' });
  });
});
