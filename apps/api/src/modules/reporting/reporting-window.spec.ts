import { describe, expect, it } from 'vitest';
import { bucketKey, resolveWindow } from './reporting-window.js';

describe('resolveWindow', () => {
  it('defaults to current calendar month when from is omitted', () => {
    const now = new Date('2026-05-11T10:00:00Z');
    const win = resolveWindow(
      {
        granularity: 'day',
        comparison: 'none',
        limit: 50,
      },
      now,
    );
    expect(win.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(win.to.getTime()).toBe(now.getTime());
    expect(win.priorFrom).toBeNull();
    expect(win.priorTo).toBeNull();
  });

  it('computes a prior_period equal to the window size', () => {
    const win = resolveWindow(
      {
        from: '2026-04-01T00:00:00Z',
        to: '2026-05-01T00:00:00Z',
        granularity: 'day',
        comparison: 'prior_period',
        limit: 50,
      },
      new Date('2026-05-11T10:00:00Z'),
    );
    expect(win.priorFrom?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(win.priorTo?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rejects an inverted window', () => {
    expect(() =>
      resolveWindow(
        {
          from: '2026-05-01T00:00:00Z',
          to: '2026-04-01T00:00:00Z',
          granularity: 'day',
          comparison: 'none',
          limit: 50,
        },
        new Date(),
      ),
    ).toThrow(/from must be before to/);
  });
});

describe('bucketKey', () => {
  it('produces day-level keys', () => {
    expect(bucketKey(new Date('2026-05-09T18:00:00Z'), 'day')).toBe('2026-05-09');
  });

  it('produces month-level keys', () => {
    expect(bucketKey(new Date('2026-05-09T18:00:00Z'), 'month')).toBe('2026-05');
  });

  it('produces ISO year-week keys', () => {
    expect(bucketKey(new Date('2026-05-09T18:00:00Z'), 'week')).toMatch(/^2026-W\d{2}$/);
  });
});
