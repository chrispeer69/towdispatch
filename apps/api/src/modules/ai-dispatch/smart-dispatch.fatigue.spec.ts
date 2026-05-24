/**
 * Unit spec — computeFatigueByDriver (PURE helper from SmartDispatchService).
 * Sums each driver's shift hours overlapping the [since, now] 24h window.
 */
import { describe, expect, it } from 'vitest';
import { computeFatigueByDriver } from './smart-dispatch.service';

const now = new Date('2026-05-20T20:00:00Z');
const since = new Date(now.getTime() - 24 * 3_600_000); // 2026-05-19T20:00Z

describe('computeFatigueByDriver', () => {
  it('open shift contributes hours up to now', () => {
    const m = computeFatigueByDriver(
      [{ driverId: 'd1', startedAt: new Date('2026-05-20T12:00:00Z'), endedAt: null }],
      since,
      now,
    );
    expect(m.get('d1')).toBeCloseTo(8, 5); // 12:00 → 20:00
  });

  it('a closed shift contributes its own span', () => {
    const m = computeFatigueByDriver(
      [
        {
          driverId: 'd1',
          startedAt: new Date('2026-05-20T08:00:00Z'),
          endedAt: new Date('2026-05-20T14:00:00Z'),
        },
      ],
      since,
      now,
    );
    expect(m.get('d1')).toBeCloseTo(6, 5);
  });

  it('clips a shift that started before the 24h window', () => {
    const m = computeFatigueByDriver(
      [{ driverId: 'd1', startedAt: new Date('2026-05-19T12:00:00Z'), endedAt: null }],
      since,
      now,
    );
    // Only 2026-05-19T20:00 (window start) → now counts = 24h.
    expect(m.get('d1')).toBeCloseTo(24, 5);
  });

  it('sums multiple shifts for the same driver', () => {
    const m = computeFatigueByDriver(
      [
        {
          driverId: 'd1',
          startedAt: new Date('2026-05-20T06:00:00Z'),
          endedAt: new Date('2026-05-20T10:00:00Z'),
        },
        {
          driverId: 'd1',
          startedAt: new Date('2026-05-20T14:00:00Z'),
          endedAt: new Date('2026-05-20T17:00:00Z'),
        },
      ],
      since,
      now,
    );
    expect(m.get('d1')).toBeCloseTo(7, 5); // 4h + 3h
  });

  it('separates drivers and reports zero for a future-only shift', () => {
    const m = computeFatigueByDriver(
      [
        { driverId: 'd1', startedAt: new Date('2026-05-20T18:00:00Z'), endedAt: null },
        {
          driverId: 'd2',
          startedAt: new Date('2026-05-21T06:00:00Z'), // after `now`
          endedAt: null,
        },
      ],
      since,
      now,
    );
    expect(m.get('d1')).toBeCloseTo(2, 5);
    expect(m.get('d2')).toBe(0);
  });
});
