'use client';

/**
 * Tiny localStorage-backed offline queue for the driver app.
 *
 * Goals:
 *   - Be cheap: no service-worker required for the queue itself
 *     (the SW is used for fetch interception, but the queue is its
 *     own data structure that survives reloads via localStorage).
 *   - Be dedup-safe: every queued action carries a clientEventUuid
 *     generated at enqueue time, so retries don't double-apply on the
 *     server (driver-offline-sync replay de-dupes by this id).
 *   - Be replay-ordered: actions replay in clientTimestamp order.
 *
 * The replay step batches all pending actions into a single POST to
 * /driver-offline-sync/replay. The server returns a per-action result
 * (applied / skipped / failed). Applied + skipped rows are removed
 * from the local queue; failed rows stay in queue with an incremented
 * attempt count so the UI can surface them on /driver/offline.
 *
 * Why not Workbox: the queue requirements are 60 lines of code and
 * pulling in Workbox would balloon the bundle. The service worker
 * (apps/web/public/sw.js) is hand-rolled too. Documented as a
 * judgment call.
 */
import { DriverApiError, DriverOfflineError, driverApi, readDriverJwt } from './api-client';
import { DRIVER_OFFLINE_QUEUE_KEY } from './storage-keys';

export type DriverOfflineActionKind =
  | 'job_status_transition'
  | 'submit_pretrip'
  | 'acknowledge_briefing'
  | 'upload_evidence'
  | 'capture_field_payment'
  | 'shift_clock_on'
  | 'shift_clock_off'
  | 'note_add';

export interface QueuedAction {
  clientEventUuid: string;
  clientTimestamp: string;
  actionKind: DriverOfflineActionKind;
  payload: Record<string, unknown>;
  jobId?: string;
  shiftId?: string;
  attemptCount: number;
  lastError?: string;
}

function uuid(): string {
  // crypto.randomUUID is required; all modern browsers support it.
  // No insecure Math.random() fallback (CodeQL #12).
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required for offline queue (browser too old)');
  }
  return crypto.randomUUID();
}

export function readQueue(): QueuedAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DRIVER_OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QueuedAction[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DRIVER_OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

export interface EnqueueInput {
  actionKind: DriverOfflineActionKind;
  payload: Record<string, unknown>;
  jobId?: string;
  shiftId?: string;
}

export function enqueueAction(input: EnqueueInput): QueuedAction {
  const action: QueuedAction = {
    clientEventUuid: uuid(),
    clientTimestamp: new Date().toISOString(),
    actionKind: input.actionKind,
    payload: input.payload,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    attemptCount: 0,
  };
  const items = readQueue();
  items.push(action);
  writeQueue(items);
  return action;
}

export function clearQueue(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRIVER_OFFLINE_QUEUE_KEY);
}

export function removeByUuid(uuids: string[]): void {
  const set = new Set(uuids);
  const items = readQueue().filter((a) => !set.has(a.clientEventUuid));
  writeQueue(items);
}

export function bumpAttempt(uuidValue: string, error: string): void {
  const items = readQueue();
  const idx = items.findIndex((a) => a.clientEventUuid === uuidValue);
  if (idx === -1) return;
  const existing = items[idx];
  if (!existing) return;
  items[idx] = { ...existing, attemptCount: existing.attemptCount + 1, lastError: error };
  writeQueue(items);
}

export interface ReplayResult {
  attempted: number;
  applied: number;
  failed: number;
  skipped: number;
}

interface ReplayResponseItem {
  clientEventUuid: string;
  status: 'applied' | 'failed' | 'skipped';
  failureReason: string | null;
}

/**
 * Send every pending action to /driver-offline-sync/replay, then prune
 * the local queue.
 */
export async function replayQueue(): Promise<ReplayResult> {
  if (!readDriverJwt()) {
    // No session — nothing to replay against.
    return { attempted: 0, applied: 0, failed: 0, skipped: 0 };
  }
  const items = readQueue();
  if (items.length === 0) return { attempted: 0, applied: 0, failed: 0, skipped: 0 };

  // Replay in clientTimestamp order so dependencies (status_change after
  // shift_clock_on) apply correctly.
  const ordered = [...items].sort((a, b) => a.clientTimestamp.localeCompare(b.clientTimestamp));

  try {
    const res = await driverApi<{ results: ReplayResponseItem[] }>(
      'POST',
      '/driver-offline-sync/replay',
      {
        actions: ordered.map((a) => ({
          actionKind: a.actionKind,
          payload: a.payload,
          clientTimestamp: a.clientTimestamp,
          clientEventUuid: a.clientEventUuid,
          ...(a.jobId ? { jobId: a.jobId } : {}),
          ...(a.shiftId ? { shiftId: a.shiftId } : {}),
        })),
      },
    );
    const applied = res.results.filter((r) => r.status === 'applied').map((r) => r.clientEventUuid);
    const skipped = res.results.filter((r) => r.status === 'skipped').map((r) => r.clientEventUuid);
    const failed = res.results.filter((r) => r.status === 'failed');
    // Applied & skipped are gone for good (skipped = server-side dedup).
    removeByUuid([...applied, ...skipped]);
    for (const f of failed) bumpAttempt(f.clientEventUuid, f.failureReason ?? 'unknown');
    return {
      attempted: ordered.length,
      applied: applied.length,
      skipped: skipped.length,
      failed: failed.length,
    };
  } catch (err) {
    if (err instanceof DriverOfflineError) {
      // Still offline. Leave the queue intact.
      return { attempted: ordered.length, applied: 0, failed: 0, skipped: 0 };
    }
    if (err instanceof DriverApiError) {
      // Server rejected the batch wholesale. Mark all rows as failed so
      // the operator can inspect on /driver/offline.
      for (const a of ordered) bumpAttempt(a.clientEventUuid, `${err.status}:${err.code}`);
      return {
        attempted: ordered.length,
        applied: 0,
        failed: ordered.length,
        skipped: 0,
      };
    }
    throw err;
  }
}

/**
 * Helper called whenever the page hears `navigator.online`. Schedules a
 * single replay; if multiple events fire in quick succession the second
 * call will see an empty queue and no-op.
 */
let replayInFlight: Promise<ReplayResult> | null = null;
export function maybeReplay(): Promise<ReplayResult> {
  if (replayInFlight) return replayInFlight;
  const p = replayQueue().finally(() => {
    replayInFlight = null;
  });
  replayInFlight = p;
  return p;
}
