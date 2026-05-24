import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  isSuccessStatus,
  planRetry,
} from './webhook-retry.logic.js';

const NOW = new Date('2026-05-24T12:00:00.000Z');

describe('webhook-retry.logic', () => {
  it('schedules the fixed backoff ladder after each failed attempt', () => {
    const expectations: Array<[number, number]> = [
      [1, 60],
      [2, 5 * 60],
      [3, 30 * 60],
      [4, 2 * 60 * 60],
    ];
    for (const [attempt, delay] of expectations) {
      const d = planRetry(attempt, DEFAULT_MAX_ATTEMPTS, NOW);
      expect(d.exhausted).toBe(false);
      expect(d.delaySeconds).toBe(delay);
      expect(d.nextRetryAt?.getTime()).toBe(NOW.getTime() + delay * 1000);
    }
  });

  it('marks the delivery exhausted once max attempts is reached', () => {
    const d = planRetry(DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, NOW);
    expect(d.exhausted).toBe(true);
    expect(d.nextRetryAt).toBeNull();
    expect(d.delaySeconds).toBeNull();
  });

  it('the backoff ladder matches the documented schedule (1m, 5m, 30m, 2h, 12h)', () => {
    expect(RETRY_BACKOFF_SECONDS).toEqual([60, 300, 1800, 7200, 43200]);
  });

  it('isSuccessStatus is true only for 2xx', () => {
    expect(isSuccessStatus(200)).toBe(true);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(299)).toBe(true);
    expect(isSuccessStatus(300)).toBe(false);
    expect(isSuccessStatus(404)).toBe(false);
    expect(isSuccessStatus(500)).toBe(false);
    expect(isSuccessStatus(null)).toBe(false);
  });
});
