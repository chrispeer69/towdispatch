'use client';

import type { CapacityStatusDto } from '@ustowdispatch/shared';
import { useState } from 'react';
import { CapacitySignalPanel } from './capacity-signal';
import { ActivePane, ConnectionPill, MapPane, useDispatchBoard } from './dispatch-shared';
/**
 * Live Dispatch — read-only operations view: Capacity Signal strip up top,
 * Active jobs on the far left, Map filling the rest. The New queue / Driver
 * roster / Recently closed panes moved to /assign-jobs (which owns the
 * drag-to-assign workflow).
 */
import type { DispatchSnapshot } from './dispatch-state';

interface Props {
  initialSnapshot: DispatchSnapshot;
  /** CADS snapshot; null when the capacity fetch failed (panel self-heals). */
  initialCapacityStatus: CapacityStatusDto | null;
  mapboxToken: string | null;
  /** Set when the dispatcher just landed here from /intake?created=... */
  createdJobNumber?: string | null;
  /** 'pending' = SMS will fire on assign; 'skipped' = no SMS for this job. */
  smsHint?: 'pending' | 'skipped' | null;
}

export function DispatchClient({
  initialSnapshot,
  initialCapacityStatus,
  mapboxToken,
  createdJobNumber = null,
  smsHint = null,
}: Props): JSX.Element {
  const { state, connected } = useDispatchBoard(initialSnapshot);
  // Driver focus: clicking a driver header in the Active panel narrows the
  // map to that driver's row + jobs. Toggle off by clicking again.
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-testid="dispatch-board">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Live Dispatch
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Read-only overview of active jobs and the map. Assign new calls from{' '}
            <a className="text-brand-primary hover:underline" href="/assign-jobs">
              Assign Jobs
            </a>
            .
          </p>
        </div>
        <ConnectionPill connected={connected} />
      </header>

      {createdJobNumber ? (
        <div
          data-testid="intake-success-toast"
          className="rounded-[12px] border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok"
        >
          Job #{createdJobNumber} created and waiting in the new queue.
          {smsHint === 'pending' ? (
            <span className="ml-1 text-text-secondary-on-dark">
              Customer tracking SMS will fire automatically on assign.
            </span>
          ) : smsHint === 'skipped' ? (
            <span className="ml-1 text-text-secondary-on-dark">
              Customer SMS skipped for this job.
            </span>
          ) : null}
        </div>
      ) : null}

      {state.toast ? (
        <div
          data-testid="dispatch-toast"
          className={`rounded-[12px] border px-4 py-3 text-sm ${
            state.toast.level === 'error'
              ? 'border-danger/40 bg-danger/10 text-danger'
              : 'border-ok/40 bg-ok/10 text-ok'
          }`}
        >
          {state.toast.message}
        </div>
      ) : null}

      <CapacitySignalPanel initialStatus={initialCapacityStatus} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <ActivePane
          jobs={state.active}
          roster={state.roster}
          completedTodayByDriver={state.completedTodayByDriver ?? {}}
          selectedDriverId={focusedDriverId}
          onSelectDriver={setFocusedDriverId}
          className="lg:col-span-3"
        />
        <MapPane
          mapboxToken={mapboxToken}
          state={state}
          focusedDriverId={focusedDriverId}
          className="lg:col-span-9"
        />
      </div>
    </div>
  );
}
