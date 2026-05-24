import { describe, expect, it } from 'vitest';
import { computeNextRun } from './schedule-clock.js';

describe('computeNextRun', () => {
  it("daily — jumps to next 08:00 UTC if we are past today's", () => {
    // Anchor: 2026-05-01 10:00 UTC. Next daily run should be 2026-05-02 08:00.
    const out = computeNextRun('daily', new Date('2026-05-01T10:00:00Z'));
    expect(out.toISOString()).toBe('2026-05-02T08:00:00.000Z');
  });

  it("daily — picks today's 08:00 if we are before it", () => {
    const out = computeNextRun('daily', new Date('2026-05-01T03:00:00Z'));
    expect(out.toISOString()).toBe('2026-05-01T08:00:00.000Z');
  });

  it('weekly — picks the next Monday 08:00 UTC', () => {
    // 2026-05-01 is a Friday. Next Monday is 2026-05-04.
    const out = computeNextRun('weekly', new Date('2026-05-01T10:00:00Z'));
    expect(out.toISOString()).toBe('2026-05-04T08:00:00.000Z');
  });

  it('monthly — picks the first of the next month 08:00 UTC', () => {
    const out = computeNextRun('monthly', new Date('2026-05-15T12:00:00Z'));
    expect(out.toISOString()).toBe('2026-06-01T08:00:00.000Z');
  });
});
