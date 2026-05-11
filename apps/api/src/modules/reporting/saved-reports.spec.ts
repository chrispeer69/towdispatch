import { describe, expect, it } from 'vitest';
import { computeNextRun } from './saved-reports.service.js';

describe('computeNextRun', () => {
  it('schedules same-day when the hour is still ahead', () => {
    const now = new Date('2026-05-11T05:00:00Z');
    const next = computeNextRun('daily', 13, now);
    expect(next.toISOString()).toBe('2026-05-11T13:00:00.000Z');
  });

  it('advances to tomorrow for daily when hour has passed', () => {
    const now = new Date('2026-05-11T15:00:00Z');
    const next = computeNextRun('daily', 13, now);
    expect(next.toISOString()).toBe('2026-05-12T13:00:00.000Z');
  });

  it('advances 7 days for weekly', () => {
    const now = new Date('2026-05-11T15:00:00Z');
    const next = computeNextRun('weekly', 13, now);
    expect(next.toISOString()).toBe('2026-05-18T13:00:00.000Z');
  });

  it('advances 1 month for monthly', () => {
    const now = new Date('2026-05-11T15:00:00Z');
    const next = computeNextRun('monthly', 13, now);
    expect(next.toISOString()).toBe('2026-06-11T13:00:00.000Z');
  });
});
