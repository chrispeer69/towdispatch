/**
 * Smoke tests for the small pure helpers in lib/api/reporting.ts.
 *
 * The fetchers themselves are exercised end-to-end by the Playwright suite;
 * here we cover the bits that have non-trivial logic without a network.
 */
import { describe, expect, it } from 'vitest';
import { formatMoneyCents } from './reporting';

describe('formatMoneyCents', () => {
  it('formats positive cents with commas and two decimals', () => {
    expect(formatMoneyCents(1234567)).toBe('$12,345.67');
    expect(formatMoneyCents(100)).toBe('$1.00');
    expect(formatMoneyCents(0)).toBe('$0.00');
  });
  it('formats negative cents with a leading dash', () => {
    expect(formatMoneyCents(-50)).toBe('-$0.50');
  });
  it('pads cents to two digits', () => {
    expect(formatMoneyCents(105)).toBe('$1.05');
    expect(formatMoneyCents(150)).toBe('$1.50');
  });
});
