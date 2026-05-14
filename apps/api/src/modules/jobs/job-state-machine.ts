/**
 * Hand-rolled job-status state machine.
 *
 * The transition map encodes the authoritative set of legal moves:
 *
 *   new          → dispatched, cancelled
 *   dispatched   → enroute, new (unassign), cancelled, goa
 *   enroute      → on_scene, cancelled, goa
 *   on_scene     → in_progress, goa, cancelled
 *   in_progress  → completed, cancelled
 *   completed    → (terminal)
 *   cancelled    → (terminal)
 *   goa          → (terminal)
 *
 * `dispatched → new` is the path used when dispatch unassigns a driver from
 * a job that hasn't started moving yet — the job goes back to the queue.
 *
 * No xstate. The logic is small enough that a table + a couple of helpers
 * is more legible than a library, and it lets us cover every move with a
 * trivial unit test.
 */
import type { JobStatus } from '@ustowdispatch/shared';

const TRANSITION_MAP: Readonly<Record<JobStatus, ReadonlyArray<JobStatus>>> = {
  new: ['dispatched', 'cancelled'],
  dispatched: ['enroute', 'new', 'cancelled', 'goa'],
  enroute: ['on_scene', 'cancelled', 'goa'],
  on_scene: ['in_progress', 'goa', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  goa: [],
};

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(['completed', 'cancelled', 'goa']);

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITION_MAP[from].includes(to);
}

export function allowedTransitions(from: JobStatus): readonly JobStatus[] {
  return TRANSITION_MAP[from];
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Every legal (from, to) pair, expanded for tests.
 */
export const VALID_TRANSITIONS: ReadonlyArray<readonly [JobStatus, JobStatus]> = (() => {
  const out: Array<readonly [JobStatus, JobStatus]> = [];
  for (const from of Object.keys(TRANSITION_MAP) as JobStatus[]) {
    for (const to of TRANSITION_MAP[from]) {
      out.push([from, to] as const);
    }
  }
  return out;
})();

/**
 * Every (from, to) pair NOT in the transition map. Used by the exhaustive
 * "invalid transitions are rejected" test.
 */
export const INVALID_TRANSITIONS: ReadonlyArray<readonly [JobStatus, JobStatus]> = (() => {
  const allStatuses: readonly JobStatus[] = [
    'new',
    'dispatched',
    'enroute',
    'on_scene',
    'in_progress',
    'completed',
    'cancelled',
    'goa',
  ];
  const out: Array<readonly [JobStatus, JobStatus]> = [];
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (from === to) continue;
      if (canTransition(from, to)) continue;
      out.push([from, to] as const);
    }
  }
  return out;
})();

export class InvalidJobTransitionError extends Error {
  readonly from: JobStatus;
  readonly to: JobStatus;
  constructor(from: JobStatus, to: JobStatus) {
    super(`Cannot transition job from '${from}' to '${to}'`);
    this.name = 'InvalidJobTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertCanTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}
