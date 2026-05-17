'use client';

/**
 * Shared dispatch board primitives used by both /dispatch (Live Dispatch:
 * Active jobs + Map) and /assign-jobs (New queue + Driver roster + DnD).
 *
 * Both pages need the same socket-driven board state and reuse the same job /
 * driver cards, so we centralize them here. Each page composes only the panes
 * it cares about.
 */
import {
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
import {
  type Dispatch,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { type Socket, io as ioClient } from 'socket.io-client';
import { toast } from 'sonner';
import { DispatchMap } from './dispatch-map';
import {
  type DispatchAction,
  type DispatchSnapshot,
  type DispatchState,
  dispatchReducer,
  initialState,
} from './dispatch-state';
import { TrackingBadge } from './tracking-badge';

export const QUEUE_DROPPABLE_ID = 'queue';

// ---------- hook: socket-driven board state ----------

export interface UseDispatchBoardResult {
  state: DispatchState;
  dispatch: Dispatch<DispatchAction>;
  connected: boolean;
  refreshBoard: () => Promise<void>;
}

export function useDispatchBoard(initialSnapshot: DispatchSnapshot): UseDispatchBoardResult {
  const [state, dispatch] = useReducer(dispatchReducer, {
    ...initialState,
    ...initialSnapshot,
  });
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const refreshBoard = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/dispatch/board', { cache: 'no-store' });
      if (!res.ok) return;
      const snap = (await res.json()) as DispatchSnapshot;
      dispatch({ type: 'snapshot', payload: snap });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    async function connect(): Promise<void> {
      try {
        const tokenRes = await fetch('/api/socket/token', { cache: 'no-store' });
        if (!tokenRes.ok) return;
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
          void refreshBoard();
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
        /* best effort */
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
  }, [refreshBoard]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: 'dismiss-toast' }), 4500);
    return () => clearTimeout(t);
  }, [state.toast]);

  return { state, dispatch, connected, refreshBoard };
}

// ---------- DnD: assign / unassign handler ----------

export function buildAssignDragHandler(
  dispatch: Dispatch<DispatchAction>,
): (event: DragEndEvent) => Promise<void> {
  return async (event: DragEndEvent): Promise<void> => {
    const jobId = event.active.id as string;
    const dropTarget = event.over?.id;
    if (!dropTarget) return;

    if (dropTarget === QUEUE_DROPPABLE_ID) {
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

    if (typeof dropTarget !== 'string' || !dropTarget.startsWith('driver:')) return;
    const [, driverId, shiftIdRaw, truckIdRaw] = dropTarget.split(':');
    if (!driverId) return;
    const shiftId = shiftIdRaw === 'none' ? null : (shiftIdRaw ?? null);
    const truckId = truckIdRaw === 'none' ? null : (truckIdRaw ?? null);

    dispatch({ type: 'optimistic-assign', jobId, driverId, truckId, shiftId });
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
  };
}

export function useAssignDndSensors(): ReturnType<typeof useSensors> {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 4 } }),
  );
}

// ---------- small shared UI ----------

export function ConnectionPill({ connected }: { connected: boolean }): JSX.Element {
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

export function EmptyState({ icon, label }: { icon: ReactNode; label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-text-secondary-on-dark">
      {icon}
      <p className="text-xs uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ---------- service-type chip colors ----------

export const SERVICE_TYPE_COLOR: Record<JobServiceType, string> = {
  // WCAG-AA contrast checked against the dark steel backdrop, drawing only
  // from the LOCKED brand palette in tailwind.config.ts.
  tow: 'bg-brand-primary/20 text-brand-primary border-brand-primary/40',
  jump_start: 'bg-info/20 text-info border-info/40',
  lockout: 'bg-info/20 text-info border-info/40',
  tire_change: 'bg-info/20 text-info border-info/40',
  fuel: 'bg-warn/20 text-warn border-warn/40',
  winch: 'bg-ok/20 text-ok border-ok/40',
  recovery: 'bg-danger/20 text-danger border-danger/40',
  impound: 'bg-violet/20 text-violet border-violet/40',
  other: 'bg-bg-base text-text-secondary-on-dark border-divider',
};

// ---------- cards ----------

export interface JobCardProps {
  job: JobDto;
  compact?: boolean;
  /** When false, the card is purely display (no drag listeners, default cursor). */
  draggable?: boolean;
}

export function JobCard({ job, compact = false, draggable = true }: JobCardProps): JSX.Element {
  const drag = useDraggable({ id: job.id });
  const { attributes, listeners, setNodeRef, transform, isDragging } = drag;
  const style: React.CSSProperties = draggable
    ? {
        transform: CSS.Transform.toString(transform) ?? undefined,
        transition: isDragging ? undefined : 'transform 120ms ease-out',
      }
    : {};
  const colorCls = SERVICE_TYPE_COLOR[job.serviceType] ?? SERVICE_TYPE_COLOR.other;
  return (
    <button
      ref={draggable ? setNodeRef : undefined}
      style={style}
      data-testid={`job-card-${job.id}`}
      data-status={job.status}
      data-service={job.serviceType}
      type="button"
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={`block w-full rounded-md border bg-bg-base/80 p-2.5 text-left text-xs transition ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      } ${draggable && isDragging ? 'opacity-50 ring-2 ring-brand-primary/60' : ''} ${colorCls}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-tight text-text-primary-on-dark">
          #{job.jobNumber}
        </span>
        <span className="font-condensed text-[10px] font-extrabold uppercase tracking-widest">
          {job.serviceType.replace('_', ' ')}
        </span>
      </div>
      {!compact ? (
        <p className="mt-1 truncate text-text-primary-on-dark/90">{job.pickupAddress}</p>
      ) : null}
    </button>
  );
}

export function DriverCard({ row }: { row: DriverRosterRow }): JSX.Element {
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
          ? 'border-divider bg-bg-base/40 opacity-60'
          : isOver
            ? 'border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/50'
            : accepting
              ? 'border-brand-primary/40 bg-bg-base/80'
              : 'border-divider bg-bg-base/80'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="font-condensed text-sm font-bold uppercase tracking-wide text-text-primary-on-dark">
          {driver.firstName} {driver.lastName}
        </p>
        {shift ? (
          <span
            className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary-on-dark"
            data-testid={`driver-status-${driver.id}`}
          >
            {shift.status.replace('_', ' ')}
          </span>
        ) : (
          <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary-on-dark">
            off
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-text-secondary-on-dark">
        <span>{truck ? truck.unitNumber : 'no truck'}</span>
        {currentJobNumber ? (
          <span className="font-mono text-text-primary-on-dark">on #{currentJobNumber}</span>
        ) : (
          <span>idle</span>
        )}
      </div>
    </div>
  );
}

// ---------- panes ----------

export function QueuePane({
  jobs,
  className,
}: {
  jobs: JobDto[];
  className?: string;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: QUEUE_DROPPABLE_ID });
  return (
    <section
      ref={setNodeRef}
      data-testid="dispatch-queue"
      className={`rounded-[14px] border bg-bg-surface/40 p-4 ${
        isOver ? 'border-brand-primary/70 ring-2 ring-brand-primary/40' : 'border-divider'
      } ${className ?? ''}`}
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          New queue
        </h2>
        <span className="rounded-full bg-bg-base px-2 py-0.5 text-xs font-semibold text-text-secondary-on-dark">
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

export function ActivePane({
  jobs,
  draggable = true,
  className,
}: {
  jobs: JobDto[];
  /**
   * On the live dispatch page (no roster/queue panes present) the active job
   * cards are read-only — disable drag so users don't grab cards that have
   * nowhere to drop.
   */
  draggable?: boolean;
  className?: string;
}): JSX.Element {
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
      className={`rounded-[14px] border border-divider bg-bg-surface/40 p-4 ${className ?? ''}`}
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          Active jobs
        </h2>
        <span className="rounded-full bg-bg-base px-2 py-0.5 text-xs font-semibold text-text-secondary-on-dark">
          {jobs.length}
        </span>
      </header>
      <div className="space-y-4">
        {(['dispatched', 'enroute', 'on_scene', 'in_progress'] as const).map((status) => {
          const group = groups[status] ?? [];
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary-on-dark">
                {status.replace('_', ' ')}
              </p>
              <ul className="space-y-2">
                {group.map((job) => (
                  <li key={job.id} className="space-y-1">
                    <JobCard job={job} compact draggable={draggable} />
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

export function RosterPane({
  roster,
  className,
}: {
  roster: DriverRosterRow[];
  className?: string;
}): JSX.Element {
  return (
    <section
      data-testid="dispatch-roster"
      className={`rounded-[14px] border border-divider bg-bg-surface/40 p-4 ${className ?? ''}`}
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          Driver roster
        </h2>
        <span className="rounded-full bg-bg-base px-2 py-0.5 text-xs font-semibold text-text-secondary-on-dark">
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

export function MapPane({
  mapboxToken,
  state,
  className,
}: {
  mapboxToken: string | null;
  state: { roster: DriverRosterRow[]; queue: JobDto[]; active: JobDto[] };
  className?: string;
}): JSX.Element {
  return (
    <section
      data-testid="dispatch-map"
      className={`rounded-[14px] border border-divider bg-bg-surface/40 p-4 ${className ?? ''}`}
    >
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          Map
        </h2>
        <span className="text-xs text-text-secondary-on-dark">
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
