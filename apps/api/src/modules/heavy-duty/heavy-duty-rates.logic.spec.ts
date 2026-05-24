/**
 * Unit tests for the pure HD rate-sheet / on-scene-estimate math. No DB / Nest.
 */
import { describe, expect, it } from 'vitest';
import {
  type HdEstimateInput,
  type HdRateSheetRates,
  computeOnSceneEstimate,
  effectiveMultiplier,
} from './heavy-duty-rates.logic.js';

const RATES: HdRateSheetRates = {
  hourlyRateCents: 25_000, // $250/hr
  hookupFeeCents: 50_000, // $500
  winchingPerHrCents: 30_000,
  recoveryPerHrCents: 40_000,
  rotatorPerHrCents: 75_000,
  mileageLoadedCents: 1_000, // $10/mi
  mileageDeadheadCents: 500,
  afterHoursMultiplier: 1.5,
  holidayMultiplier: 2,
};

function input(overrides: Partial<HdEstimateInput> = {}): HdEstimateInput {
  return {
    laborHours: 0,
    winchingHours: 0,
    recoveryHours: 0,
    rotatorHours: 0,
    loadedMiles: 0,
    deadheadMiles: 0,
    includeHookup: false,
    afterHours: false,
    holiday: false,
    ...overrides,
  };
}

describe('computeOnSceneEstimate', () => {
  it('emits only non-zero lines and sums the subtotal', () => {
    const r = computeOnSceneEstimate(
      RATES,
      input({ includeHookup: true, laborHours: 2, loadedMiles: 30 }),
    );
    expect(r.lines.map((l) => l.code)).toEqual(['hookup', 'labor', 'mileage_loaded']);
    // 50000 + 2*25000 + 30*1000 = 50000 + 50000 + 30000 = 130000
    expect(r.subtotalCents).toBe(130_000);
    expect(r.multiplier).toBe(1);
    expect(r.totalCents).toBe(130_000);
  });

  it('rounds fractional-hour line amounts', () => {
    const r = computeOnSceneEstimate(RATES, input({ rotatorHours: 1.5 }));
    // 1.5 * 75000 = 112500
    expect(r.lines[0]?.amountCents).toBe(112_500);
  });

  it('applies the after-hours multiplier to the total', () => {
    const r = computeOnSceneEstimate(RATES, input({ laborHours: 4, afterHours: true }));
    // subtotal 100000 * 1.5 = 150000
    expect(r.subtotalCents).toBe(100_000);
    expect(r.multiplier).toBe(1.5);
    expect(r.totalCents).toBe(150_000);
  });

  it('does NOT stack multipliers — takes the higher of after-hours / holiday', () => {
    const r = computeOnSceneEstimate(
      RATES,
      input({ laborHours: 4, afterHours: true, holiday: true }),
    );
    expect(r.multiplier).toBe(2); // holiday wins, not 1.5 * 2
    expect(r.totalCents).toBe(200_000);
  });

  it('returns an empty estimate when nothing is entered', () => {
    const r = computeOnSceneEstimate(RATES, input());
    expect(r.lines).toEqual([]);
    expect(r.subtotalCents).toBe(0);
    expect(r.totalCents).toBe(0);
  });

  it('skips the hookup line when the fee is zero even if requested', () => {
    const r = computeOnSceneEstimate(
      { ...RATES, hookupFeeCents: 0 },
      input({ includeHookup: true, laborHours: 1 }),
    );
    expect(r.lines.map((l) => l.code)).toEqual(['labor']);
  });
});

describe('effectiveMultiplier', () => {
  it('floors at 1 when no premium applies', () => {
    expect(effectiveMultiplier(RATES, input())).toBe(1);
  });
  it('uses the single applicable premium', () => {
    expect(effectiveMultiplier(RATES, input({ afterHours: true }))).toBe(1.5);
    expect(effectiveMultiplier(RATES, input({ holiday: true }))).toBe(2);
  });
});
