/**
 * Verifies that the retry-config policy matrix matches the contract in
 * docs/notifications.md. If you change the policy on purpose, update this
 * file AND the docs in the same commit.
 *
 * We assert the static export so the test doesn't need to instantiate a
 * real BullMQ Queue (which would open a Redis connection).
 */
import { describe, expect, it } from 'vitest';
import { NOTIFY_RETRY_CONFIG, NOTIFY_QUEUE_NAMES } from './notifications-queue.service.js';

const EXPECTED_POLICY = {
  push: { attempts: 3, type: 'exponential', delay: 5_000 },
  sms: { attempts: 2, type: 'fixed', delay: 60_000 },
  email: { attempts: 3, type: 'exponential', delay: 30_000 },
  webhook: { attempts: 5, type: 'exponential', delay: 60_000 },
  in_app: { attempts: 1, type: 'fixed', delay: 0 },
} as const;

describe('NotificationsQueueService retry policy', () => {
  it('matches the documented matrix', () => {
    for (const [channel, want] of Object.entries(EXPECTED_POLICY)) {
      const got = NOTIFY_RETRY_CONFIG[channel as keyof typeof NOTIFY_QUEUE_NAMES];
      expect(got, channel).toBeDefined();
      expect(got.attempts, `${channel} attempts`).toBe(want.attempts);
      expect(got.backoff.type, `${channel} backoff.type`).toBe(want.type);
      expect(got.backoff.delay, `${channel} backoff.delay`).toBe(want.delay);
    }
  });

  it('declares one queue per channel', () => {
    const channels = Object.keys(NOTIFY_QUEUE_NAMES);
    expect(channels.sort()).toEqual(['email', 'in_app', 'push', 'sms', 'webhook']);
    for (const c of channels) {
      expect(NOTIFY_QUEUE_NAMES[c as keyof typeof NOTIFY_QUEUE_NAMES]).toMatch(/^notify:/);
    }
  });
});
