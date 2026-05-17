/**
 * Pure unit tests for dynamic-pricing helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  applyStackToBase,
  localDateKey,
  localDow,
  localHour,
  pickDemandSurgeTier,
  resolveCurveMultiplier,
  resolveHolidayDate,
  stackTiers,
  trailingBaseline,
} from './dynamic-pricing-helpers.js';

describe('stackTiers', () => {
  it('returns 1.0 with no tiers', () => {
    const r = stackTiers([], 3.0);
    expect(r.effectiveMultiplier).toBe(1);
    expect(r.appliedTiers).toEqual([]);
    expect(r.capped).toBe(false);
  });

  it('multiplies across different categories', () => {
    const r = stackTiers(
      [
        { tierId: 'a', name: 'W', category: 'weather', multiplier: 1.5 },
        { tierId: 'b', name: 'C', category: 'calendar', multiplier: 1.2 },
      ],
      3.0,
    );
    expect(r.effectiveMultiplier).toBeCloseTo(1.8, 5);
    expect(r.appliedTiers).toHaveLength(2);
  });

  it('takes the max within a single category', () => {
    const r = stackTiers(
      [
        { tierId: 'a', name: 'low', category: 'weather', multiplier: 1.2 },
        { tierId: 'b', name: 'hi', category: 'weather', multiplier: 1.8 },
      ],
      3.0,
    );
    expect(r.effectiveMultiplier).toBeCloseTo(1.8, 5);
    expect(r.appliedTiers).toHaveLength(1);
    expect(r.suppressedTiers).toHaveLength(1);
  });

  it('caps the effective multiplier at the supplied cap', () => {
    const r = stackTiers(
      [
        { tierId: 'a', name: 'W', category: 'weather', multiplier: 2.5 },
        { tierId: 'b', name: 'C', category: 'calendar', multiplier: 2.0 },
        { tierId: 'c', name: 'T', category: 'time_of_day', multiplier: 1.5 },
      ],
      3.0,
    );
    // 2.5 * 2.0 * 1.5 = 7.5 → cap 3.0
    expect(r.effectiveMultiplier).toBe(3.0);
    expect(r.capped).toBe(true);
  });

  it('does not cap below the raw product when within cap', () => {
    const r = stackTiers([{ tierId: 'a', name: 'W', category: 'weather', multiplier: 1.2 }], 3.0);
    expect(r.capped).toBe(false);
  });
});

describe('applyStackToBase', () => {
  it('returns base unchanged for empty stack', () => {
    const r = applyStackToBase(10000, stackTiers([], 3.0));
    expect(r.finalCents).toBe(10000);
  });

  it('rounds the final cents to the nearest integer', () => {
    const r = applyStackToBase(
      10000,
      stackTiers([{ tierId: 'a', name: 'X', category: 'weather', multiplier: 1.135 }], 3.0),
    );
    expect(r.finalCents).toBe(11350);
  });

  it('distributes per-tier contribution by marginal multiplier', () => {
    const stack = stackTiers(
      [
        { tierId: 'a', name: 'A', category: 'weather', multiplier: 1.5 },
        { tierId: 'b', name: 'B', category: 'calendar', multiplier: 1.2 },
      ],
      3.0,
    );
    const r = applyStackToBase(10000, stack);
    // total = 18000 → delta 8000. Marginals: 0.5 + 0.2 = 0.7. A gets 5/7, B gets 2/7.
    expect(r.finalCents).toBe(18000);
    const aShare = r.perTierContribution.get('a') ?? 0;
    const bShare = r.perTierContribution.get('b') ?? 0;
    expect(aShare + bShare).toBe(8000);
    expect(aShare).toBeGreaterThan(bShare);
  });
});

describe('resolveCurveMultiplier', () => {
  it('reads 24-hour curve at the local hour boundary', () => {
    const curve = Array(24).fill(1.0);
    curve[22] = 1.3;
    const m = resolveCurveMultiplier(curve, '24_hour', 3, 22);
    expect(m).toBe(1.3);
  });

  it('reads 7×24 grid at the dow + hour boundary', () => {
    const grid: number[][] = [];
    for (let dow = 0; dow < 7; dow++) {
      grid.push(Array(24).fill(1.0));
    }
    const sat = grid[6];
    if (!sat) throw new Error('grid setup failed');
    sat[20] = 1.15; // Saturday 8 PM
    const m = resolveCurveMultiplier(grid, '7x24', 6, 20);
    expect(m).toBe(1.15);
  });

  it('returns 1.0 on malformed curves', () => {
    expect(resolveCurveMultiplier([1, 2, 3] as unknown as number[], '24_hour', 0, 0)).toBe(1);
    expect(resolveCurveMultiplier([] as unknown as number[][], '7x24', 0, 0)).toBe(1);
  });
});

describe('trailingBaseline', () => {
  it('returns null with no usable cells', () => {
    expect(trailingBaseline([])).toBeNull();
  });
  it('averages 4-week cells', () => {
    expect(trailingBaseline([10, 20, 30, 40])).toBe(25);
  });
  it('handles partial history (fewer than 4 weeks)', () => {
    expect(trailingBaseline([10, 20])).toBe(15);
  });
});

describe('pickDemandSurgeTier', () => {
  const thresholds = [150, 200, 300];
  const multipliers = [1.3, 1.6, 2.0];

  it('returns null when baseline is zero', () => {
    expect(pickDemandSurgeTier(10, 0, thresholds, multipliers)).toBeNull();
  });

  it('returns null below the lowest threshold', () => {
    expect(pickDemandSurgeTier(12, 10, thresholds, multipliers)).toBeNull();
  });

  it('picks the highest matching threshold', () => {
    // current = 25, baseline = 10 → 250% → 200% threshold matches (300% does not)
    expect(pickDemandSurgeTier(25, 10, thresholds, multipliers)).toEqual({
      thresholdPct: 200,
      multiplier: 1.6,
    });
  });

  it('picks 300% when the ratio breaches it', () => {
    expect(pickDemandSurgeTier(35, 10, thresholds, multipliers)).toEqual({
      thresholdPct: 300,
      multiplier: 2.0,
    });
  });
});

describe('resolveHolidayDate', () => {
  it('resolves fixed_date Independence Day 2026', () => {
    const dt = resolveHolidayDate('fixed_date', { month: 7, day: 4 }, 2026);
    expect(dt?.getUTCMonth()).toBe(6);
    expect(dt?.getUTCDate()).toBe(4);
  });

  it('resolves Thanksgiving 2026 (4th Thursday of November)', () => {
    const dt = resolveHolidayDate('nth_weekday', { month: 11, weekday: 4, ordinal: 4 }, 2026);
    // Nov 4 2026 is a Wednesday; first Thursday is Nov 5; +3 weeks = Nov 26
    expect(dt?.getUTCDate()).toBe(26);
  });

  it('resolves Memorial Day 2026 (last Monday of May)', () => {
    const dt = resolveHolidayDate('nth_weekday', { month: 5, weekday: 1, ordinal: -1 }, 2026);
    // May 25 2026 is a Monday
    expect(dt?.getUTCDate()).toBe(25);
  });

  it('returns null on invalid spec', () => {
    expect(resolveHolidayDate('fixed_date', { month: 2, day: 30 }, 2026)).toBeNull();
  });
});

describe('local time helpers', () => {
  // 2026-05-17T15:30:00Z → 11:30 EDT (America/New_York is in DST in May).
  const reference = new Date('2026-05-17T15:30:00Z');

  it('localDateKey returns YYYY-MM-DD in tz', () => {
    expect(localDateKey(reference, 'America/New_York')).toBe('2026-05-17');
  });

  it('localHour returns 0..23', () => {
    expect(localHour(reference, 'America/New_York')).toBe(11);
    expect(localHour(reference, 'UTC')).toBe(15);
  });

  it('localDow returns 0..6 (0=Sun)', () => {
    // 2026-05-17 was a Sunday.
    expect(localDow(reference, 'America/New_York')).toBe(0);
  });
});
