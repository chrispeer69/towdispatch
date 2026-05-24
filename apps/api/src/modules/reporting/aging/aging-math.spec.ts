/**
 * Unit coverage for A/R aging math (Session 53) — day-count + bucket edges
 * across DST, leap years, weekends, and exact boundaries.
 */
import { describe, expect, it } from 'vitest';
import { ageInDays, bucketOf, normalizeBuckets } from './aging-math.js';

describe('ageInDays', () => {
  it('counts whole days past due', () => {
    expect(ageInDays(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T00:00:00Z'))).toBe(30);
  });

  it('is negative for a not-yet-due invoice', () => {
    expect(ageInDays(new Date('2026-05-31T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))).toBe(-30);
  });

  it('is unaffected by a US DST spring-forward (UTC ms diff)', () => {
    // 2026-03-08 is the US DST transition. UTC math ignores it.
    expect(ageInDays(new Date('2026-03-07T12:00:00Z'), new Date('2026-03-09T12:00:00Z'))).toBe(2);
  });

  it('counts a leap-day February correctly', () => {
    // 2028 is a leap year; Feb has 29 days.
    expect(ageInDays(new Date('2028-02-01T00:00:00Z'), new Date('2028-03-01T00:00:00Z'))).toBe(29);
  });

  it('floors a partial day', () => {
    expect(ageInDays(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-02T18:00:00Z'))).toBe(1);
  });
});

describe('bucketOf', () => {
  const buckets: [number, number, number] = [30, 60, 90];
  it('classifies current / b1 / b2 / b3plus by boundary', () => {
    expect(bucketOf(-5, buckets)).toBe('current');
    expect(bucketOf(0, buckets)).toBe('current');
    expect(bucketOf(29, buckets)).toBe('current');
    expect(bucketOf(30, buckets)).toBe('b1'); // boundary is inclusive of the lower edge
    expect(bucketOf(59, buckets)).toBe('b1');
    expect(bucketOf(60, buckets)).toBe('b2');
    expect(bucketOf(89, buckets)).toBe('b2');
    expect(bucketOf(90, buckets)).toBe('b3plus');
    expect(bucketOf(400, buckets)).toBe('b3plus');
  });

  it('respects custom thresholds', () => {
    expect(bucketOf(20, [15, 45, 75])).toBe('b1');
    expect(bucketOf(80, [15, 45, 75])).toBe('b3plus');
  });
});

describe('normalizeBuckets', () => {
  it('defaults to 30/60/90 when missing or empty', () => {
    expect(normalizeBuckets(undefined)).toEqual([30, 60, 90]);
    expect(normalizeBuckets([])).toEqual([30, 60, 90]);
  });

  it('sorts, floors, and drops non-positive values', () => {
    expect(normalizeBuckets([90.5, 30.9, 60.1])).toEqual([30, 60, 90]);
    expect(normalizeBuckets([45, -1, 15])).toEqual([15, 45, 90]);
  });
});
