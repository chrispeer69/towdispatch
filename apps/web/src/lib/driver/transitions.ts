/**
 * Driver-side job state-machine helpers.
 *
 * The driver app drives jobs through the same state machine the operator
 * console uses (see apps/api/src/modules/jobs/job-state-machine.ts).
 * The driver-facing buttons are derived from the current status so we
 * never offer an illegal transition.
 *
 * Why we route every transition through /driver-offline-sync/replay
 * instead of /dispatch/jobs/:id/transition: the latter is RBAC-gated
 * and only accepts operator JWTs. The replay endpoint accepts driver
 * JWTs and supports `job_status_transition` actions, so we use it for
 * both online and offline flows. Documented as a Session 3 judgment
 * call.
 */
import type { JobStatus } from '@ustowdispatch/shared';
import { driverApi } from './api-client';
import { enqueueAction } from './offline-queue';

export interface DriverTransitionResult {
  status: 'applied' | 'queued' | 'failed';
  reason?: string;
}

const DRIVER_NEXT_STATUSES: Readonly<Partial<Record<JobStatus, JobStatus[]>>> = {
  dispatched: ['enroute'],
  enroute: ['on_scene'],
  on_scene: ['in_progress'],
  in_progress: ['completed'],
};

export function nextAllowed(status: JobStatus): JobStatus[] {
  return DRIVER_NEXT_STATUSES[status] ?? [];
}

export const STATUS_LABEL: Readonly<Record<JobStatus, string>> = {
  new: 'New',
  dispatched: 'Dispatched',
  enroute: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  goa: 'GOA',
};

export const STATUS_CTA: Readonly<Partial<Record<JobStatus, string>>> = {
  enroute: 'Mark en route',
  on_scene: 'Arrive on scene',
  in_progress: 'Start service',
  completed: 'Complete job',
};

export interface DriverTransitionInput {
  jobId: string;
  to: JobStatus;
  reason?: string;
  /** Current GPS coordinates; attached to the action payload. */
  lat?: number;
  lng?: number;
}

/**
 * Apply a transition. On success the API returns a per-action result.
 * On network failure we enqueue the action and report `queued` so the
 * UI can refresh from local state.
 */
export async function applyDriverTransition(
  input: DriverTransitionInput,
): Promise<DriverTransitionResult> {
  const payload: Record<string, unknown> = { toStatus: input.to };
  if (input.reason) payload.reason = input.reason;
  if (input.lat != null && input.lng != null) {
    payload.lat = input.lat;
    payload.lng = input.lng;
  }
  try {
    const res = await driverApi<{
      results: { status: 'applied' | 'failed' | 'skipped'; failureReason: string | null }[];
    }>('POST', '/driver-offline-sync/replay', {
      actions: [
        {
          actionKind: 'job_status_transition',
          jobId: input.jobId,
          payload,
          clientTimestamp: new Date().toISOString(),
          clientEventUuid: crypto.randomUUID(),
        },
      ],
    });
    const first = res.results[0];
    if (!first) return { status: 'failed', reason: 'empty-response' };
    if (first.status === 'applied' || first.status === 'skipped') return { status: 'applied' };
    return { status: 'failed', reason: first.failureReason ?? 'unknown' };
  } catch (err) {
    // Network failure → queue. Server-side errors propagate as queued
    // too; the operator can replay manually from /driver/offline.
    enqueueAction({
      actionKind: 'job_status_transition',
      payload,
      jobId: input.jobId,
    });
    return { status: 'queued', reason: (err as Error).message };
  }
}
