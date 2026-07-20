'use client';

/**
 * Assign Jobs client — owns the drag-to-assign workflow that used to live on
 * /dispatch. New queue on the left, Driver roster on the right; dnd-kit wires
 * drag-onto-driver = assign, drag-back-to-queue = unassign.
 */
import { DndContext } from '@dnd-kit/core';
import {
  ConnectionPill,
  QueuePane,
  RosterPane,
  buildAssignDragHandler,
  useAssignDndSensors,
  useDispatchBoard,
} from '../dispatch/dispatch-shared';
import type { DispatchSnapshot } from '../dispatch/dispatch-state';

interface Props {
  initialSnapshot: DispatchSnapshot;
}

import { ConvinicarAlarmModal } from '@/components/convinicar-alarm-modal';

export function AssignJobsClient({ initialSnapshot }: Props): JSX.Element {
  const { state, dispatch, connected } = useDispatchBoard(initialSnapshot);
  const sensors = useAssignDndSensors();
  const onDragEnd = buildAssignDragHandler(dispatch);

  const convinicarOffer = state.queue.find((j) => j.convinicarOfferId && j.status === 'new') || null;

  return (
    <div className="space-y-4" data-testid="assign-jobs-board">
      <ConvinicarAlarmModal
        job={convinicarOffer}
        onClose={() => {}}
      />
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Assign Jobs
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Click the job number to open its details. Grab anywhere else on the card to drag it onto
            a driver — drag back to the queue to unassign.
          </p>
        </div>
        <ConnectionPill connected={connected} />
      </header>

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

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <QueuePane jobs={state.queue} className="lg:col-span-4" />
          <RosterPane roster={state.roster} className="lg:col-span-8" />
        </div>
      </DndContext>
    </div>
  );
}
