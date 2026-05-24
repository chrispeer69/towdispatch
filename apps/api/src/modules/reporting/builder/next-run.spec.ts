/**
 * Unit coverage for the builder schedule clock (Session 53). UTC wall-clock,
 * so DST in the presentation timezone never shifts the computed instant.
 */
import { describe, expect, it } from 'vitest';
import { computeTemplateNextRun } from './next-run.js';

describe('computeTemplateNextRun — daily', () => {
  it('returns today at the delivery time when it is still ahead', () => {
    const now = new Date('2026-05-24T03:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'daily', deliveryAtLocal: '06:00', deliveryDow: null, deliveryDom: null },
      now,
    );
    expect(next.toISOString()).toBe('2026-05-24T06:00:00.000Z');
  });

  it('rolls to tomorrow when the delivery time has passed', () => {
    const now = new Date('2026-05-24T07:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'daily', deliveryAtLocal: '06:00', deliveryDow: null, deliveryDom: null },
      now,
    );
    expect(next.toISOString()).toBe('2026-05-25T06:00:00.000Z');
  });
});

describe('computeTemplateNextRun — weekly', () => {
  it('advances to the next occurrence of the target weekday', () => {
    // 2026-05-24 is a Sunday (getUTCDay 0). Target Wednesday (3).
    const now = new Date('2026-05-24T10:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'weekly', deliveryAtLocal: '06:00', deliveryDow: 3, deliveryDom: null },
      now,
    );
    expect(next.getUTCDay()).toBe(3);
    expect(next.toISOString()).toBe('2026-05-27T06:00:00.000Z');
  });

  it('jumps a full week when today is the target day but the time has passed', () => {
    const now = new Date('2026-05-24T08:00:00Z'); // Sunday, after 06:00
    const next = computeTemplateNextRun(
      { cadence: 'weekly', deliveryAtLocal: '06:00', deliveryDow: 0, deliveryDom: null },
      now,
    );
    expect(next.toISOString()).toBe('2026-05-31T06:00:00.000Z');
  });
});

describe('computeTemplateNextRun — monthly', () => {
  it('uses this month when the target day is still ahead', () => {
    const now = new Date('2026-05-10T00:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'monthly', deliveryAtLocal: '06:00', deliveryDow: null, deliveryDom: 15 },
      now,
    );
    expect(next.toISOString()).toBe('2026-05-15T06:00:00.000Z');
  });

  it('rolls to next month when the target day has passed', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'monthly', deliveryAtLocal: '06:00', deliveryDow: null, deliveryDom: 15 },
      now,
    );
    expect(next.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('clamps an out-of-range day-of-month to the 1st', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const next = computeTemplateNextRun(
      { cadence: 'monthly', deliveryAtLocal: '06:00', deliveryDow: null, deliveryDom: 31 },
      now,
    );
    expect(next.getUTCDate()).toBe(1);
    expect(next.getUTCMonth()).toBe(5); // June (0-indexed)
  });
});
