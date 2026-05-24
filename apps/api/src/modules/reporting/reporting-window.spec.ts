import { describe, expect, it } from 'vitest';
import { filterHash, resolveWindow } from './reporting-window.js';

describe('resolveWindow', () => {
  it('defaults to a 30-day trailing window when no dates given', () => {
    const w = resolveWindow({});
    const span = w.toDate.getTime() - w.fromDate.getTime();
    const days = Math.round(span / (24 * 60 * 60 * 1000));
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('respects explicit from/to', () => {
    const w = resolveWindow({
      fromDate: '2026-01-01T00:00:00.000Z',
      toDate: '2026-01-31T23:59:59.000Z',
    });
    expect(w.fromDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.toDate.toISOString()).toBe('2026-01-31T23:59:59.000Z');
  });

  it('computes prior_period as the equal-length window ending the day before', () => {
    const w = resolveWindow({
      fromDate: '2026-02-01T00:00:00.000Z',
      toDate: '2026-02-28T00:00:00.000Z',
      comparison: 'prior_period',
    });
    expect(w.comparisonToDate?.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    // ~27 days back from comparisonToDate.
    const span = w.toDate.getTime() - w.fromDate.getTime();
    const compSpan = (w.comparisonToDate?.getTime() ?? 0) - (w.comparisonFromDate?.getTime() ?? 0);
    expect(Math.abs(compSpan - span)).toBeLessThan(2000);
  });

  it('computes prior_year as -365d on both bounds', () => {
    const w = resolveWindow({
      fromDate: '2026-05-01T00:00:00.000Z',
      toDate: '2026-05-31T00:00:00.000Z',
      comparison: 'prior_year',
    });
    expect(w.comparisonFromDate?.getUTCFullYear()).toBe(2025);
    expect(w.comparisonToDate?.getUTCFullYear()).toBe(2025);
  });

  it('returns null comparison bounds when comparison=none', () => {
    const w = resolveWindow({ comparison: 'none' });
    expect(w.comparisonFromDate).toBeNull();
    expect(w.comparisonToDate).toBeNull();
  });
});

describe('filterHash', () => {
  it('is stable across key order', () => {
    const a = filterHash({ x: 1, y: 2 });
    const b = filterHash({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it('differs when values differ', () => {
    expect(filterHash({ x: 1 })).not.toBe(filterHash({ x: 2 }));
  });

  it('handles nested objects', () => {
    expect(filterHash({ x: { a: 1, b: [1, 2] } })).toBe(filterHash({ x: { b: [1, 2], a: 1 } }));
  });
});
