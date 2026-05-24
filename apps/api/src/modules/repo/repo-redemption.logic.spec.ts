/**
 * Unit coverage for the pure repo-case math (Session 49): the redemption-
 * window date computation (calendar-day edges: weekends, leap day, DST,
 * month/year rollover) and the case status machine.
 */
import { describe, expect, it } from 'vitest';
import {
  canTransition,
  computeRedemptionEnd,
  isAttemptable,
  isRecoverable,
} from './repo-redemption.logic.js';

describe('computeRedemptionEnd', () => {
  it('adds whole calendar days in UTC', () => {
    const recovered = new Date('2026-03-01T12:00:00.000Z');
    expect(computeRedemptionEnd(recovered, 15).toISOString()).toBe('2026-03-16T12:00:00.000Z');
  });

  it('crosses a weekend without skipping days (calendar, not business, days)', () => {
    // Fri 2026-05-22 + 3 days = Mon 2026-05-25 (Sat/Sun count).
    const fri = new Date('2026-05-22T09:00:00.000Z');
    expect(computeRedemptionEnd(fri, 3).toISOString()).toBe('2026-05-25T09:00:00.000Z');
  });

  it('handles the leap day (2028-02-29 + 1 = 2028-03-01)', () => {
    const leap = new Date('2028-02-29T00:00:00.000Z');
    expect(computeRedemptionEnd(leap, 1).toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  it('lands correctly across a Feb-non-leap-year boundary', () => {
    const feb = new Date('2027-02-28T06:30:00.000Z');
    expect(computeRedemptionEnd(feb, 1).toISOString()).toBe('2027-03-01T06:30:00.000Z');
  });

  it('is DST-immune: the UTC time-of-day is preserved across a US spring-forward', () => {
    // US DST began 2026-03-08. A window spanning it stays exactly N×24h in UTC
    // (no wall-clock hour drift), because the math is UTC, not local.
    const before = new Date('2026-03-06T15:00:00.000Z');
    const end = computeRedemptionEnd(before, 5);
    expect(end.toISOString()).toBe('2026-03-11T15:00:00.000Z');
    expect(end.getTime() - before.getTime()).toBe(5 * 86_400_000);
  });

  it('rolls over year end', () => {
    const dec = new Date('2026-12-30T23:00:00.000Z');
    expect(computeRedemptionEnd(dec, 5).toISOString()).toBe('2027-01-04T23:00:00.000Z');
  });

  it('treats a 0-day window as ending at the recovery instant', () => {
    const t = new Date('2026-06-01T10:00:00.000Z');
    expect(computeRedemptionEnd(t, 0).toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });

  it('clamps negative / fractional windows', () => {
    const t = new Date('2026-06-01T10:00:00.000Z');
    expect(computeRedemptionEnd(t, -5).toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(computeRedemptionEnd(t, 2.9).toISOString()).toBe('2026-06-03T10:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const t = new Date('2026-06-01T10:00:00.000Z');
    computeRedemptionEnd(t, 30);
    expect(t.toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });
});

describe('repo case status machine', () => {
  it('allows the happy path open → located → recovered → closed', () => {
    expect(canTransition('open', 'located')).toBe(true);
    expect(canTransition('located', 'recovered')).toBe(true);
    expect(canTransition('recovered', 'closed')).toBe(true);
  });

  it('allows voluntary surrender and its close', () => {
    expect(canTransition('open', 'surrendered')).toBe(true);
    expect(canTransition('surrendered', 'closed')).toBe(true);
  });

  it('allows cancellation only from open / located', () => {
    expect(canTransition('open', 'cancelled')).toBe(true);
    expect(canTransition('located', 'cancelled')).toBe(true);
    expect(canTransition('recovered', 'cancelled')).toBe(false);
  });

  it('rejects illegal moves', () => {
    expect(canTransition('closed', 'open')).toBe(false);
    expect(canTransition('cancelled', 'recovered')).toBe(false);
    expect(canTransition('recovered', 'located')).toBe(false);
    expect(canTransition('closed', 'closed')).toBe(false);
  });

  it('gates attempts/recovery to open + located only', () => {
    expect(isAttemptable('open')).toBe(true);
    expect(isAttemptable('located')).toBe(true);
    expect(isAttemptable('recovered')).toBe(false);
    expect(isRecoverable('open')).toBe(true);
    expect(isRecoverable('closed')).toBe(false);
  });
});
