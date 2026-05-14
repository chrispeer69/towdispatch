'use client';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  DISPATCH_EVENTS,
  type DriverRosterRow,
  type JobAssignedEvent,
  type JobDto,
  type JobServiceType,
  type JobStatusChangedEvent,
} from '@ustowdispatch/shared';
import { Inbox, MapPin, Truck, Users } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { type Socket, io as ioClient } from 'socket.io-client';
import { toast } from 'sonner';
import { DispatchMap } from './dispatch-map';
import { type DispatchSnapshot, dispatchReducer, initialState } from './dispatch-state';
import { TrackingBadge } from './tracking-badge';

interface Props {
  initialSnapshot: DispatchSnapshot;
  mapboxToken: string | null;
  /**
   * Set when the dispatcher just landed here from /intake?created=...
   * Surfaces a success banner so the test contract from Session 4 is
   * preserved on top of the live dispatch board.
   */
  createdJobNumber?: string | null;
  /** 'pending' = SMS will fire on assign; 'skipped' = no SMS for this job. */
  smsHint?: 'pending' | 'skipped' | null;
}

const QUEUE_DROPPABLE_ID = 'queue';

export function DispatchClient({
  initialSnapshot,
  mapboxToken,
  createdJobNumber = null,
  smsHint = null,
}: Props): JSX.Element {
  const [state, dispatch] = useReducer(dispatchReducer, {
    ...initialState,
    ...initialSnapshot,
  });
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ---------- socket lifecycle ----------
  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    async function connect(): Promise<void> {
      try {
        const tokenRes = await fetch('/api/socket/token', { cache: 'no-store' });
        if (!tokenRes.ok) {
          // No socket = no live updates, but the SSR snapshot is still useful.
          // We used to hard-redirect to /login on a 401 here, but that path
          // races the layout's already-authenticated render: if /auth/me hits
          // a transient flake (or the BFF can't refresh) the dispatcher gets
          // bounced off a perfectly valid session. The next server render goes
          // through requireUser() which is the real chokepoint — let that
          // decide whether the session is dead.
          return;
        }
        const { accessToken, apiUrl } = (await tokenRes.json()) as {
          accessToken: string;
          apiUrl: string;
        };
        if (cancelled) return;
        socket = ioClient(apiUrl, {
          path: '/socket.io',
          auth: { token: accessToken },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 500,
          reconnectionDelayMax: 5_000,
        });
        socketRef.current = socket;

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', () => setConnected(false));

        socket.on(DISPATCH_EVENTS.JOB_CREATED, (payload: { job: JobDto }) => {
          dispatch({ type: 'job-created', job: payload.job });
        });
        socket.on(DISPATCH_EVENTS.JOB_STATUS_CHANGED, (payload: JobStatusChangedEvent) => {
          dispatch({
            type: 'job-status-changed',
            jobId: payload.jobId,
            toStatus: payload.toStatus,
          });
        });
        socket.on(DISPATCH_EVENTS.JOB_ASSIGNED, (payload: JobAssignedEvent) => {
          // Refetch board on assignment from another dispatcher to pick up
          // both the job movement and the roster current-job update.
          void refreshBoard();
          // Also reflect immediately if it's a known job in our state.
          dispatch({
            type: 'job-status-changed',
            jobId: payload.jobId,
            toStatus: payload.status,
          });
        });
        socket.on(DISPATCH_EVENTS.DRIVER_LOCATION_CHANGED, (payload) => {
          const p = payload as { shiftId: string; lat: number; lng: number };
          dispatch({ type: 'driver-location', shiftId: p.shiftId, lat: p.lat, lng: p.lng });
        });
        socket.on(DISPATCH_EVENTS.DRIVER_STATUS_CHANGED, (payload) => {
          const p = payload as { shiftId: string; status: string };
          dispatch({ type: 'shift-status', shiftId: p.shiftId, status: p.status });
        });
        socket.on(DISPATCH_EVENTS.DRIVER_SHIFT_STARTED, () => {
          void refreshBoard();
        });
        socket.on(DISPATCH_EVENTS.DRIVER_SHIFT_ENDED, () => {
          void refreshBoard();
        });
      } catch {
        // Best effort — UI continues on the snapshot.
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, []);

  // ---------- toast auto-dismiss ----------
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: 'dismiss-toast' }), 4500);
    return () => clearTimeout(t);
  }, [state.toast]);

  async function refreshBoard(): Promise<void> {
    try {
      const res = await fetch('/api/dispatch/board', { cache: 'no-store' });
      if (!res.ok) return;
      const snap = (await res.json()) as DispatchSnapshot;
      dispatch({ type: 'snapshot', payload: snap });
    } catch {
      /* ignore */
    }
  }

  // ---------- DnD ----------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 4 } }),
  );

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    const jobId = event.active.id as string;
    const dropTarget = event.over?.id;
    if (!dropTarget) return;

    if (dropTarget === QUEUE_DROPPABLE_ID) {
      // Drop onto the queue → unassign.
      dispatch({ type: 'optimistic-unassign', jobId });
      try {
        const res = await fetch(`/api/dispatch/jobs/${jobId}/unassign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'dispatcher unassigned via drag' }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          const reason = body.message ?? 'unassign failed';
          dispatch({ type: 'rollback', jobId, reason });
          toast.error(`Unassign rolled back: ${reason}`);
          return;
        }
        const job = (await res.json()) as JobDto;
        dispatch({ type: 'commit', jobId, job });
      } catch {
        dispatch({ type: 'rollback', jobId, reason: 'network error' });
        toast.error('Unassign rolled back: network error');
      }
      return;
    }

    // Otherwise dropTarget is `driver:<driverId>:<shiftId | none>:<truckId | none>`
    if (typeof dropTarget !== 'string' || !dropTarget.startsWith('driver:')) return;
    const [, driverId, shiftIdRaw, truckIdRaw] = dropTarget.split(':');
    if (!driverId) return;
    const shiftId = shiftIdRaw === 'none' ? null : (shiftIdRaw ?? null);
    const truckId = truckIdRaw === 'none' ? null : (truckIdRaw ?? null);

    dispatch({
      type: 'optimistic-assign',
      jobId,
      driverId,
      truckId,
      shiftId,
    });
    try {
      const res = await fetch(`/api/dispatch/jobs/${jobId}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          driverId,
          ...(truckId ? { truckId } : {}),
          ...(shiftId ? { shiftId } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        const reason = body.message ?? 'assignment failed';
        dispatch({ type: 'rollback', jobId, reason });
        // 409 indicates the concurrency-conflict path added in 17B (see
        // apps/api/src/modules/jobs/jobs.service.ts). Show a focused
        // conflict message so the dispatcher knows to refresh.
        if (res.status === 409) {
          toast.error('Already assigned by another dispatcher. Refresh and try again.');
        } else {
          toast.error(`Assignment rolled back: ${reason}`);
        }
        return;
      }
      const job = (await res.json()) as JobDto;
      dispatch({ type: 'commit', jobId, job });
      toast.success('Job assigned');
    } catch {
      dispatch({ type: 'rollback', jobId, reason: 'network error' });
      toast.error('Assignment rolled back: network error');
    }
  }

  return (
    <div className="space-y-4" data-testid="dispatch-board">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Live Dispatch
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Drag a job onto a driver to assign. Drag back to the queue to unassign.
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
            <span className="ml-1 text-text-secondary">
              Customer tracking SMS will fire automatically on assign.
            </span>
          ) : smsHint === 'skipped' ? (
            <span className="ml-1 text-text-secondary">Customer SMS skipped for this job.</span>
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

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <QueuePane jobs={state.queue} />
          <ActivePane jobs={state.active} />
          <RosterPane roster={state.roster} />
          <RecentlyCompletedPane jobs={state.recentlyCompleted} />
          <MapPane mapboxToken={mapboxToken} state={state} />
        </div>
      </DndContext>
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }): JSX.Element {
  return (
    <span
      data-testid="dispatch-connection"
      data-connected={connected ? 'true' : 'false'}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        connected ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-ok' : 'bg-warn animate-pulse'}`} />
      {connected ? 'live' : 'connecting…'}
    </span>
  );
}

// ---------- panes ----------

function QueuePane({ jobs }: { jobs: JobDto[] }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: QUEUE_DROPPABLE_ID });
  return (
    <section
      ref={setNodeRef}
      data-testid="dispatch-queue"
      className={`lg:col-span-3 rounded-[14px] border bg-steel-mid/40 p-4 ${
        isOver ? 'border-orange/70 ring-2 ring-orange/40' : 'border-steel-border'
      }`}
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          New queue
        </h2>
        <span className="rounded-full bg-steel px-2 py-0.5 text-xs font-semibold text-text-secondary">
          {jobs.length}
        </span>
      </header>
      {jobs.length === 0 ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} label="No jobs in queue" />
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivePane({ jobs }: { jobs: JobDto[] }): JSX.Element {
  const groups: Record<string, JobDto[]> = {
    dispatched: [],
    enroute: [],
    on_scene: [],
    in_progress: [],
  };
  for (const j of jobs) {
    if (groups[j.status]) groups[j.status]?.push(j);
  }
  return (
    <section
      data-testid="dispatch-active"
      className="lg:col-span-4 rounded-[14px] border border-steel-border bg-steel-mid/40 p-4"
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          Active jobs
        </h2>
        <span className="rounded-full bg-steel px-2 py-0.5 text-xs font-semibold text-text-secondary">
          {jobs.length}
        </span>
      </header>
      <div className="space-y-4">
        {(['dispatched', 'enroute', 'on_scene', 'in_progress'] as const).map((status) => {
          const group = groups[status] ?? [];
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                {status.replace('_', ' ')}
              </p>
              <ul className="space-y-2">
                {group.map((job) => (
                  <li key={job.id} className="space-y-1">
                    <JobCard job={job} compact />
                    <div className="flex justify-end pr-1">
                      <TrackingBadge jobId={job.id} jobNumber={job.jobNumber} canRevoke />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {jobs.length === 0 ? (
          <EmptyState icon={<Truck className="h-5 w-5" />} label="No active jobs" />
        ) : null}
      </div>
    </section>
  );
}

function RosterPane({ roster }: { roster: DriverRosterRow[] }): JSX.Element {
  return (
    <section
      data-testid="dispatch-roster"
      className="lg:col-span-5 rounded-[14px] border border-steel-border bg-steel-mid/40 p-4"
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          Driver roster
        </h2>
        <span className="rounded-full bg-steel px-2 py-0.5 text-xs font-semibold text-text-secondary">
          {roster.filter((r) => r.shift && !r.shift.endedAt).length} on shift
        </span>
      </header>
      {roster.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} label="No drivers yet" />
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {roster.map((row) => (
            <li key={row.driver.id}>
              <DriverCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentlyCompletedPane({ jobs }: { jobs: JobDto[] }): JSX.Element {
  return (
    <section
      data-testid="dispatch-completed"
      className="lg:col-span-3 rounded-[14px] border border-steel-border bg-steel-mid/40 p-4"
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          Recently closed
        </h2>
        <span className="rounded-full bg-steel px-2 py-0.5 text-xs font-semibold text-text-secondary">
          {jobs.length}
        </span>
      </header>
      {jobs.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-secondary">Nothing closed today yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between rounded-md bg-steel/60 px-2 py-1.5 text-xs"
            >
              <span className="font-mono text-text-primary">#{job.jobNumber}</span>
              <span className="font-condensed font-bold uppercase tracking-wider text-text-secondary">
                {job.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MapPane({
  mapboxToken,
  state,
}: {
  mapboxToken: string | null;
  state: { roster: DriverRosterRow[]; queue: JobDto[]; active: JobDto[] };
}): JSX.Element {
  return (
    <section
      data-testid="dispatch-map"
      className="lg:col-span-9 rounded-[14px] border border-steel-border bg-steel-mid/40 p-4"
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
          Map
        </h2>
        <span className="text-xs text-text-secondary">
          <MapPin className="inline h-3.5 w-3.5" /> Mapbox
        </span>
      </header>
      <DispatchMap
        token={mapboxToken}
        roster={state.roster}
        jobs={[...state.queue, ...state.active]}
      />
    </section>
  );
}

function EmptyState({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-text-secondary">
      {icon}
      <p className="text-xs uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ---------- cards ----------

const SERVICE_TYPE_COLOR: Record<JobServiceType, string> = {
  // WCAG-AA contrast checked against the dark steel backdrop, drawing only
  // from the LOCKED brand palette in tailwind.config.ts (orange / ok / warn /
  // danger / info / violet) so the dispatch board does not introduce a new
  // color system. Distinct serviceTypes that share a slot are grouped by
  // operational category — heavy/recovery on warn (caution), light maintenance
  // on info (informational), money/impound on violet (commercial).
  tow: 'bg-orange/20 text-orange border-orange/40',
  jump_start: 'bg-info/20 text-info border-info/40',
  lockout: 'bg-info/20 text-info border-info/40',
  tire_change: 'bg-info/20 text-info border-info/40',
  fuel: 'bg-warn/20 text-warn border-warn/40',
  winch: 'bg-ok/20 text-ok border-ok/40',
  recovery: 'bg-danger/20 text-danger border-danger/40',
  impound: 'bg-violet/20 text-violet border-violet/40',
  other: 'bg-steel text-text-secondary border-steel-border',
};

function JobCard({ job, compact = false }: { job: JobDto; compact?: boolean }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: isDragging ? undefined : 'transform 120ms ease-out',
  };
  const colorCls = SERVICE_TYPE_COLOR[job.serviceType] ?? SERVICE_TYPE_COLOR.other;
  return (
    <button
      ref={setNodeRef}
      style={style}
      data-testid={`job-card-${job.id}`}
      data-status={job.status}
      data-service={job.serviceType}
      type="button"
      {...attributes}
      {...listeners}
      className={`block w-full cursor-grab rounded-md border bg-steel/80 p-2.5 text-left text-xs transition active:cursor-grabbing ${
        isDragging ? 'opacity-50 ring-2 ring-orange/60' : ''
      } ${colorCls}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-tight text-text-primary">
          #{job.jobNumber}
        </span>
        <span className="font-condensed text-[10px] font-extrabold uppercase tracking-widest">
          {job.serviceType.replace('_', ' ')}
        </span>
      </div>
      {!compact ? <p className="mt-1 truncate text-text-primary/90">{job.pickupAddress}</p> : null}
    </button>
  );
}

function DriverCard({ row }: { row: DriverRosterRow }): JSX.Element {
  const { driver, shift, truck, currentJobNumber } = row;
  const onShift = !!shift && !shift.endedAt;
  const id = `driver:${driver.id}:${shift?.id ?? 'none'}:${truck?.id ?? 'none'}`;
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const accepting = !!active && onShift;
  return (
    <div
      ref={setNodeRef}
      data-testid={`driver-card-${driver.id}`}
      data-on-shift={onShift ? 'true' : 'false'}
      data-shift-id={shift?.id ?? ''}
      className={`rounded-md border p-3 transition ${
        !onShift
          ? 'border-steel-border bg-steel/40 opacity-60'
          : isOver
            ? 'border-orange bg-orange/10 ring-2 ring-orange/50'
            : accepting
              ? 'border-orange/40 bg-steel/80'
              : 'border-steel-border bg-steel/80'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="font-condensed text-sm font-bold uppercase tracking-wide text-text-primary">
          {driver.firstName} {driver.lastName}
        </p>
        {shift ? (
          <span
            className="rounded-full bg-steel-mid px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary"
            data-testid={`driver-status-${driver.id}`}
          >
            {shift.status.replace('_', ' ')}
          </span>
        ) : (
          <span className="rounded-full bg-steel-mid px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            off
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-text-secondary">
        <span>{truck ? truck.unitNumber : 'no truck'}</span>
        {currentJobNumber ? (
          <span className="font-mono text-text-primary">on #{currentJobNumber}</span>
        ) : (
          <span>idle</span>
        )}
      </div>
    </div>
  );
}
