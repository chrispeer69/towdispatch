/**
 * Unit coverage for the pure storage-rate math (Yard Management, Session 54):
 * classifyVehicle, resolveRate, rateWindowsOverlap, computeDailyStorageCharge,
 * and the UTC date helpers. No DB / Nest container.
 */
import { describe, expect, it } from 'vitest';
import {
  type RateCardLike,
  classifyVehicle,
  computeDailyStorageCharge,
  diffUtcDays,
  rateWindowsOverlap,
  resolveRate,
} from './storage-rate.logic.js';

const cls = (over: Partial<Parameters<typeof classifyVehicle>[0]> = {}) =>
  classifyVehicle({
    dispatchClass: null,
    bodyClass: null,
    gvwrLbs: null,
    axleCount: null,
    ...over,
  });

describe('classifyVehicle', () => {
  it('defaults to passenger when nothing is known', () => {
    expect(cls()).toBe('passenger');
  });
  it('motorcycle by dispatch class or body', () => {
    expect(cls({ dispatchClass: 'motorcycle' })).toBe('motorcycle');
    expect(cls({ bodyClass: 'Motorcycle' })).toBe('motorcycle');
  });
  it('trailer by body', () => {
    expect(cls({ bodyClass: 'utility trailer' })).toBe('trailer');
  });
  it('rv by dispatch class or body', () => {
    expect(cls({ dispatchClass: 'rv' })).toBe('rv');
    expect(cls({ bodyClass: 'Motorhome' })).toBe('rv');
  });
  it('heavy by GVWR >= 26001, by >= 3 axles, or by dispatch class', () => {
    expect(cls({ gvwrLbs: 26_001 })).toBe('heavy');
    expect(cls({ axleCount: 3 })).toBe('heavy');
    expect(cls({ dispatchClass: 'heavy_duty' })).toBe('heavy');
    expect(cls({ dispatchClass: 'commercial' })).toBe('heavy');
  });
  it('light_truck by medium_duty, mid GVWR, or truck/van/pickup body', () => {
    expect(cls({ dispatchClass: 'medium_duty' })).toBe('light_truck');
    expect(cls({ gvwrLbs: 12_000 })).toBe('light_truck');
    expect(cls({ bodyClass: 'Pickup' })).toBe('light_truck');
    expect(cls({ bodyClass: 'cargo van' })).toBe('light_truck');
  });
  it('passenger for light_duty / sedan / car', () => {
    expect(cls({ dispatchClass: 'light_duty' })).toBe('passenger');
    expect(cls({ bodyClass: 'sedan' })).toBe('passenger');
  });
  it('body category wins over weight (a motorcycle is never heavy)', () => {
    expect(cls({ bodyClass: 'motorcycle', gvwrLbs: 30_000 })).toBe('motorcycle');
  });
});

describe('resolveRate', () => {
  const card = (id: string, from: string, to: string | null): RateCardLike => ({
    id,
    effectiveFrom: from,
    effectiveTo: to,
    dailyRateCents: 1000,
    freeDays: 0,
    maxDailyRateCents: null,
  });

  it('returns null on a gap (no card covers the date)', () => {
    expect(resolveRate([card('a', '2026-01-01', '2026-01-31')], '2026-02-15')).toBeNull();
  });
  it('returns null for empty card list', () => {
    expect(resolveRate([], '2026-01-01')).toBeNull();
  });
  it('picks the card whose window covers the date', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31'), card('cur', '2026-01-01', null)];
    expect(resolveRate(cards, '2026-06-01')?.id).toBe('cur');
  });
  it('among multiple covering cards picks the latest effective_from', () => {
    const cards = [card('a', '2026-01-01', null), card('b', '2026-03-01', null)];
    expect(resolveRate(cards, '2026-06-01')?.id).toBe('b');
  });
  it('respects the closed end date', () => {
    expect(resolveRate([card('a', '2026-01-01', '2026-06-30')], '2026-06-30')?.id).toBe('a');
    expect(resolveRate([card('a', '2026-01-01', '2026-06-30')], '2026-07-01')).toBeNull();
  });
});

describe('rateWindowsOverlap', () => {
  it('detects overlapping open-ended windows', () => {
    expect(
      rateWindowsOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: null },
        { effectiveFrom: '2026-06-01', effectiveTo: null },
      ),
    ).toBe(true);
  });
  it('adjacent non-overlapping windows do not overlap', () => {
    expect(
      rateWindowsOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
        { effectiveFrom: '2026-04-01', effectiveTo: '2026-06-30' },
      ),
    ).toBe(false);
  });
  it('touching boundaries (same day) overlap', () => {
    expect(
      rateWindowsOverlap(
        { effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
        { effectiveFrom: '2026-03-31', effectiveTo: null },
      ),
    ).toBe(true);
  });
});

describe('computeDailyStorageCharge', () => {
  const c = { dailyRateCents: 4000, freeDays: 3, maxDailyRateCents: null };

  it('waives charge during the free-day window (dayIndex < freeDays)', () => {
    expect(computeDailyStorageCharge(c, 0)).toEqual({ charged: false, amountCents: 0 });
    expect(computeDailyStorageCharge(c, 2)).toEqual({ charged: false, amountCents: 0 });
  });
  it('charges the daily rate once past the free days', () => {
    expect(computeDailyStorageCharge(c, 3)).toEqual({ charged: true, amountCents: 4000 });
  });
  it('caps a day at max_daily_rate_cents when lower', () => {
    expect(
      computeDailyStorageCharge({ dailyRateCents: 4000, freeDays: 0, maxDailyRateCents: 2500 }, 0),
    ).toEqual({ charged: true, amountCents: 2500 });
  });
  it('cap above the rate has no effect', () => {
    expect(
      computeDailyStorageCharge({ dailyRateCents: 4000, freeDays: 0, maxDailyRateCents: 9000 }, 0),
    ).toEqual({ charged: true, amountCents: 4000 });
  });
  it('negative dayIndex (charge date before storage start) never charges', () => {
    expect(computeDailyStorageCharge(c, -1)).toEqual({ charged: false, amountCents: 0 });
  });
  it('zero free days charges from day 0', () => {
    expect(
      computeDailyStorageCharge({ dailyRateCents: 1500, freeDays: 0, maxDailyRateCents: null }, 0),
    ).toEqual({ charged: true, amountCents: 1500 });
  });
});

describe('diffUtcDays (partial-day = full calendar day)', () => {
  it('same day = 0, arrival counts as day 0', () => {
    expect(diffUtcDays('2026-05-24', '2026-05-24')).toBe(0);
  });
  it('a partial extra day still counts as one whole day index', () => {
    // storage started 2026-05-24, charge date 2026-05-26 → dayIndex 2.
    expect(diffUtcDays('2026-05-24', '2026-05-26')).toBe(2);
  });
});
