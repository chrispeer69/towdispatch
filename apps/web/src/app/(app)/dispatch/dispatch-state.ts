/**
 * Dispatch board state + reducer.
 *
 * The board's snapshot has four buckets — queue, active, recentlyCompleted,
 * roster — plus a dictionary of pending optimistic ops keyed by jobId we
 * use to roll back if the server rejects a move.
 *
 * This module is pure (no React, no DOM) so the reducer can be exercised
 * directly under vitest in apps/api or future apps/web tests.
 */
import type { DriverRosterRow, JobDto } from '@ustowdispatch/shared';

export interface DispatchSnapshot {
  queue: JobDto[];
  active: JobDto[];
  recentlyCompleted: JobDto[];
  roster: DriverRosterRow[];
  /**
   * driverId -> completed-today tow count. Server-supplied; the dispatcher
   * UI surfaces this as a chip next to each driver's name in the Active
   * panel. Optional so older snapshots (e.g. cached preview) don't crash.
   */
  completedTodayByDriver?: Record<string, number>;
}

export interface DispatchState extends DispatchSnapshot {
  /**
   * jobId -> snapshot of the job before an optimistic move. Populated when
   * the dispatcher drags a card; cleared when the server confirms or
   * rejects.
   */
  pending: Record<string, JobDto>;
  toast: { id: number; level: 'info' | 'error'; message: string } | null;
}

export type DispatchAction =
  | { type: 'snapshot'; payload: DispatchSnapshot }
  | {
      type: 'optimistic-assign';
      jobId: string;
      driverId: string;
      truckId: string | null;
      shiftId: string | null;
    }
  | { type: 'optimistic-unassign'; jobId: string }
  | { type: 'commit'; jobId: string; job: JobDto }
  | { type: 'rollback'; jobId: string; reason: string }
  | { type: 'job-created'; job: JobDto }
  | { type: 'job-status-changed'; jobId: string; toStatus: string }
  | { type: 'roster-update'; roster: DriverRosterRow[] }
  | { type: 'shift-status'; shiftId: string; status: string }
  | { type: 'driver-location'; shiftId: string; lat: number; lng: number }
  | { type: 'dismiss-toast' };

const TOAST_LIMIT = 1; // single rolling toast suffices for this UI

let nextToastId = 1;

export const initialState: DispatchState = {
  queue: [],
  active: [],
  recentlyCompleted: [],
  roster: [],
  completedTodayByDriver: {},
  pending: {},
  toast: null,
};

function classifyJob(job: JobDto): 'queue' | 'active' | 'recently_completed' | 'gone' {
  if (job.deletedAt) return 'gone';
  if (job.status === 'new') return 'queue';
  if (
    job.status === 'dispatched' ||
    job.status === 'enroute' ||
    job.status === 'on_scene' ||
    job.status === 'in_progress'
  ) {
    return 'active';
  }
  return 'recently_completed';
}

function placeJob(state: DispatchState, job: JobDto): DispatchState {
  // Carry forward joined customer/vehicle from the prior in-state copy.
  // Socket events (job-assigned, job-status-changed, commit-after-assign)
  // re-publish a plain JobDto without the dispatch-board joins, so without
  // this merge the Active panel would lose the "LastName - year make model"
  // line on every status transition.
  const prior = findJob(state, job.id);
  const merged: JobDto =
    prior && (prior.customer !== undefined || prior.vehicle !== undefined)
      ? {
          ...job,
          customer: job.customer ?? prior.customer,
          vehicle: job.vehicle ?? prior.vehicle,
        }
      : job;
  const queue = state.queue.filter((j) => j.id !== merged.id);
  const active = state.active.filter((j) => j.id !== merged.id);
  const recentlyCompleted = state.recentlyCompleted.filter((j) => j.id !== merged.id);
  const dest = classifyJob(merged);
  if (dest === 'queue') {
    return { ...state, queue: [...queue, merged], active, recentlyCompleted };
  }
  if (dest === 'active') {
    return { ...state, queue, active: [...active, merged], recentlyCompleted };
  }
  if (dest === 'recently_completed') {
    return {
      ...state,
      queue,
      active,
      recentlyCompleted: [merged, ...recentlyCompleted].slice(0, 10),
    };
  }
  return { ...state, queue, active, recentlyCompleted };
}

function removeJob(state: DispatchState, jobId: string): DispatchState {
  return {
    ...state,
    queue: state.queue.filter((j) => j.id !== jobId),
    active: state.active.filter((j) => j.id !== jobId),
    recentlyCompleted: state.recentlyCompleted.filter((j) => j.id !== jobId),
  };
}

function findJob(state: DispatchState, jobId: string): JobDto | undefined {
  return (
    state.queue.find((j) => j.id === jobId) ??
    state.active.find((j) => j.id === jobId) ??
    state.recentlyCompleted.find((j) => j.id === jobId)
  );
}

export function dispatchReducer(state: DispatchState, action: DispatchAction): DispatchState {
  switch (action.type) {
    case 'snapshot': {
      return { ...state, ...action.payload };
    }
    case 'optimistic-assign': {
      const job = findJob(state, action.jobId);
      if (!job) return state;
      const optimistic: JobDto = {
        ...job,
        status: 'dispatched',
        assignedDriverId: action.driverId,
        assignedTruckId: action.truckId,
        assignedShiftId: action.shiftId,
        assignedAt: new Date().toISOString(),
      };
      return {
        ...placeJob(state, optimistic),
        pending: { ...state.pending, [action.jobId]: job },
      };
    }
    case 'optimistic-unassign': {
      const job = findJob(state, action.jobId);
      if (!job) return state;
      const optimistic: JobDto = {
        ...job,
        status: 'new',
        assignedDriverId: null,
        assignedTruckId: null,
        assignedShiftId: null,
        assignedAt: null,
      };
      return {
        ...placeJob(state, optimistic),
        pending: { ...state.pending, [action.jobId]: job },
      };
    }
    case 'commit': {
      const next = placeJob(state, action.job);
      const pending = { ...next.pending };
      delete pending[action.jobId];
      return { ...next, pending };
    }
    case 'rollback': {
      const previous = state.pending[action.jobId];
      const pending = { ...state.pending };
      delete pending[action.jobId];
      const restored = previous ? placeJob({ ...state, pending }, previous) : { ...state, pending };
      return {
        ...restored,
        toast: makeToast('error', action.reason),
      };
    }
    case 'job-created': {
      return placeJob(state, action.job);
    }
    case 'job-status-changed': {
      const job = findJob(state, action.jobId);
      if (!job) return state;
      // Server is authoritative on status — pull a fresh /board on reconnect
      // for full reconciliation, but mirror trivial transitions inline.
      return placeJob(state, { ...job, status: action.toStatus as JobDto['status'] });
    }
    case 'roster-update': {
      return { ...state, roster: action.roster };
    }
    case 'shift-status': {
      return {
        ...state,
        roster: state.roster.map((row) => {
          if (!row.shift || row.shift.id !== action.shiftId) return row;
          return {
            ...row,
            shift: { ...row.shift, status: action.status as typeof row.shift.status },
          };
        }),
      };
    }
    case 'driver-location': {
      return {
        ...state,
        roster: state.roster.map((row) => {
          if (!row.shift || row.shift.id !== action.shiftId) return row;
          return {
            ...row,
            shift: {
              ...row.shift,
              lastLat: action.lat,
              lastLng: action.lng,
              lastPositionAt: new Date().toISOString(),
            },
          };
        }),
      };
    }
    case 'dismiss-toast':
      return { ...state, toast: null };
    default:
      return state;
  }
}

function makeToast(
  level: 'info' | 'error',
  message: string,
): { id: number; level: 'info' | 'error'; message: string } {
  // Rolling counter so consecutive identical toasts re-render and re-trigger
  // the auto-dismiss timer.
  return { id: nextToastId++ % 1_000_000, level, message };
}

// Re-export internals for unit testing.
export const __test = { classifyJob, placeJob, removeJob, findJob, TOAST_LIMIT };
