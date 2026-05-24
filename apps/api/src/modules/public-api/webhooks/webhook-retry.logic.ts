/**
 * Pure webhook retry/backoff scheduling (Session 29). No I/O — unit tested.
 *
 * Fixed backoff ladder measured from the just-finished attempt:
 *   attempt 1 failed -> +1m, 2 -> +5m, 3 -> +30m, 4 -> +2h, 5 -> +12h
 * After max_attempts failures the delivery is terminal ('failed').
 *
 * `attempt` here is the number of the attempt that JUST RAN (1-based). The
 * ladder index is attempt-1.
 */
export const RETRY_BACKOFF_SECONDS: readonly number[] = [
  60, // after attempt 1
  5 * 60, // after attempt 2
  30 * 60, // after attempt 3
  2 * 60 * 60, // after attempt 4
  12 * 60 * 60, // after attempt 5 (only used if max_attempts raised)
];

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface RetryDecision {
  /** Terminal? true => mark 'failed', no further retry. */
  exhausted: boolean;
  /** When the next attempt becomes due (null when exhausted). */
  nextRetryAt: Date | null;
  /** The backoff applied, in seconds (null when exhausted). */
  delaySeconds: number | null;
}

/**
 * Decide the next state after a FAILED attempt.
 * @param attempt        the attempt number that just ran (1-based)
 * @param maxAttempts    the delivery's max_attempts
 * @param now            current time (injectable for tests)
 */
export function planRetry(attempt: number, maxAttempts: number, now: Date): RetryDecision {
  if (attempt >= maxAttempts) {
    return { exhausted: true, nextRetryAt: null, delaySeconds: null };
  }
  // attempt is 1-based; the delay that follows attempt N is ladder[N-1].
  const idx = Math.min(attempt - 1, RETRY_BACKOFF_SECONDS.length - 1);
  const delaySeconds =
    RETRY_BACKOFF_SECONDS[idx] ?? RETRY_BACKOFF_SECONDS[RETRY_BACKOFF_SECONDS.length - 1] ?? 60;
  return {
    exhausted: false,
    delaySeconds,
    nextRetryAt: new Date(now.getTime() + delaySeconds * 1000),
  };
}

/** A 2xx response is success; everything else (incl. network error) retries. */
export function isSuccessStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}
