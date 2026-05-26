import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bumpAttempt,
  clearQueue,
  enqueueAction,
  readQueue,
  removeByUuid,
  replayQueue,
} from '../offline-queue';
import { DRIVER_JWT_KEY } from '../storage-keys';

/**
 * The queue talks to localStorage and `fetch` (via driverApi). We
 * stub the global `window` with a minimal shape so the module-under-test
 * can be exercised in the default node vitest environment.
 */

interface FakeStorage {
  store: Record<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
}

function fakeStorage(): FakeStorage {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (k) => (k in store ? (store[k] as string) : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

const originalGlobals = {
  window: globalThis.window,
  localStorage: globalThis.localStorage,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch,
};

beforeEach(() => {
  const storage = fakeStorage();
  // @ts-expect-error -- minimal Window mock for module-under-test
  globalThis.window = { localStorage: storage, location: { hostname: 'localhost' } };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
  // crypto.randomUUID is required by enqueueAction.
  if (typeof globalThis.crypto === 'undefined') {
    // vitest node env may lack crypto.randomUUID
    (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto = {
      randomUUID: () => {
        const hex = '0123456789abcdef';
        let s = '';
        for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
        return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
      },
    };
  }
});

afterEach(() => {
  // restore the real globals so we don't pollute other tests
  if (originalGlobals.window) globalThis.window = originalGlobals.window;
  else (globalThis as { window?: unknown }).window = undefined;
  if (originalGlobals.localStorage)
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalGlobals.localStorage,
      configurable: true,
    });
  vi.restoreAllMocks();
});

describe('offline queue lifecycle', () => {
  it('enqueues, reads, and clears actions', () => {
    expect(readQueue()).toEqual([]);
    const a = enqueueAction({
      actionKind: 'job_status_transition',
      jobId: '00000000-0000-0000-0000-000000000001',
      payload: { toStatus: 'enroute' },
    });
    expect(a.clientEventUuid).toMatch(/^[0-9a-f-]+$/);
    const b = enqueueAction({
      actionKind: 'note_add',
      payload: { text: 'Customer wasn’t at the address' },
    });
    expect(readQueue().length).toBe(2);
    removeByUuid([a.clientEventUuid]);
    expect(readQueue().length).toBe(1);
    expect(readQueue()[0]?.clientEventUuid).toBe(b.clientEventUuid);
    clearQueue();
    expect(readQueue()).toEqual([]);
  });

  it('preserves dedup uuid across retries (server-side dedup contract)', () => {
    const a = enqueueAction({
      actionKind: 'acknowledge_briefing',
      payload: { briefingId: 'b1' },
    });
    bumpAttempt(a.clientEventUuid, '503:offline');
    bumpAttempt(a.clientEventUuid, '503:offline');
    const [stored] = readQueue();
    expect(stored?.clientEventUuid).toBe(a.clientEventUuid);
    expect(stored?.attemptCount).toBe(2);
    expect(stored?.lastError).toBe('503:offline');
  });

  it('returns a no-op replay result when there is no jwt', async () => {
    enqueueAction({ actionKind: 'note_add', payload: {} });
    const result = await replayQueue();
    expect(result).toEqual({ attempted: 0, applied: 0, failed: 0, skipped: 0 });
    // Queue is preserved.
    expect(readQueue().length).toBe(1);
  });

  it('drops applied + skipped entries on a successful replay and keeps failures', async () => {
    globalThis.localStorage.setItem(DRIVER_JWT_KEY, 'ZmFrZS1qd3Q='); // btoa('fake-jwt')
    const applied = enqueueAction({ actionKind: 'note_add', payload: { text: 'a' } });
    const skipped = enqueueAction({ actionKind: 'note_add', payload: { text: 'b' } });
    const failed = enqueueAction({ actionKind: 'note_add', payload: { text: 'c' } });

    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { clientEventUuid: applied.clientEventUuid, status: 'applied', failureReason: null },
              { clientEventUuid: skipped.clientEventUuid, status: 'skipped', failureReason: null },
              {
                clientEventUuid: failed.clientEventUuid,
                status: 'failed',
                failureReason: 'invalid_state_transition',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    const result = await replayQueue();
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const remaining = readQueue();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.clientEventUuid).toBe(failed.clientEventUuid);
    expect(remaining[0]?.attemptCount).toBe(1);
    expect(remaining[0]?.lastError).toBe('invalid_state_transition');
  });
});
