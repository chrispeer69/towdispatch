'use client';

/**
 * Demo dispatch board — simplified mock of the real dispatch board.
 * Shows queue, active jobs, and driver roster with drag-to-assign concept.
 */

import { cn } from '@/lib/utils';
import { Radio } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEMO_DRIVERS, DEMO_JOBS } from '../mock-data';
import { DemoMapPane, type SimStatus } from './demo-map-pane';

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  dispatched: 'Dispatched',
  enroute: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  goa: 'GOA',
};

const SHIFT_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  en_route: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  returning: 'Returning',
  break: 'On break',
};

const SERVICE_LABEL: Record<string, string> = {
  tow: 'Tow',
  jump_start: 'Jump start',
  lockout: 'Lockout',
  tire_change: 'Tire change',
  fuel: 'Fuel',
  winch: 'Winch',
  recovery: 'Recovery',
  impound: 'Impound',
  repo: 'Repossession',
  other: 'Other',
};

export default function DemoDispatchPage(): JSX.Element {
  const [simStatus, setSimStatus] = useState<SimStatus>('idle');

  const displayDrivers = useMemo(() => {
    return DEMO_DRIVERS.map((d) => {
      if (d.driverId === 'drv-001' && simStatus !== 'idle') {
        return {
          ...d,
          shiftStatus: simStatus === 'completed' ? 'available' : 'en_route',
          currentJobStatus: simStatus === 'completed' ? null : simStatus,
        };
      }
      return d;
    });
  }, [simStatus]);

  const displayJobs = useMemo(() => {
    return DEMO_JOBS.map((j) => {
      if (j.id === 'job-001' && simStatus !== 'idle') {
        return {
          ...j,
          status: simStatus,
        };
      }
      return j;
    });
  }, [simStatus]);

  const queue = displayJobs.filter((j) => j.status === 'new' || j.status === 'dispatched');
  const active = displayJobs.filter(
    (j) => j.status === 'enroute' || j.status === 'on_scene' || j.status === 'in_progress',
  );
  const recentlyCompleted = displayJobs.filter((j) => j.status === 'completed').slice(0, 3);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
      <header className="space-y-1 shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-brand-primary" />
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Live Dispatch Board
          </h1>
        </div>
        <p className="text-sm text-text-secondary-on-dark">
          Read-only overview of active jobs and the map. All data is demo-only.
        </p>
      </header>

      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3 flex flex-col gap-4 overflow-y-auto pr-1 pb-4">
          {/* Active */}
          <div className="rounded-[14px] border border-divider bg-bg-surface p-5 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
                Active
              </h3>
              <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok">
                {active.length}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {active.length === 0 ? (
                <p className="text-sm text-text-secondary-on-dark/60">No active jobs</p>
              ) : null}
              {active.map((job) => (
                <div
                  key={job.id}
                  className="rounded-[10px] border border-divider bg-bg-surface-elevated/30 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-brand-primary">
                      #{job.jobNumber}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                        'border-brand-primary/40 bg-brand-primary/10 text-brand-primary',
                      )}
                    >
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text-primary-on-dark">
                    {job.customerName}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary-on-dark">
                    {SERVICE_LABEL[job.serviceType] ?? job.serviceType} -{' '}
                    {job.driverName ?? 'Unassigned'}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-text-secondary-on-dark/70">
                    📍 {job.pickupAddress}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Queue */}
          <div className="rounded-[14px] border border-divider bg-bg-surface p-5 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
                Queue
              </h3>
              <span className="rounded-full border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
                {queue.length}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {queue.length === 0 ? (
                <p className="text-sm text-text-secondary-on-dark/60">Queue empty</p>
              ) : null}
              {queue.map((job) => (
                <div
                  key={job.id}
                  className="cursor-grab rounded-[10px] border border-divider bg-bg-surface-elevated/30 p-3 transition-all hover:border-brand-primary/40 hover:shadow-sm active:cursor-grabbing"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-brand-primary">
                      #{job.jobNumber}
                    </span>
                    <span className="rounded-full border border-divider bg-bg-surface px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text-primary-on-dark">
                    {job.customerName}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary-on-dark">
                    {SERVICE_LABEL[job.serviceType] ?? job.serviceType} - {job.vehicleDesc}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-text-secondary-on-dark/70">
                    📍 {job.pickupAddress}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Driver Roster */}
          <div
            id="demo-sidebar-roster"
            className="rounded-[14px] border border-divider bg-bg-surface p-5 shrink-0"
          >
            <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
              Driver Roster
            </h3>
            <div className="mt-4 space-y-2">
              {displayDrivers.map((d) => {
                const statusLabel = d.currentJobStatus
                  ? (STATUS_LABEL[d.currentJobStatus] ?? d.currentJobStatus)
                  : (SHIFT_STATUS_LABEL[d.shiftStatus] ?? d.shiftStatus);
                const isAvailable = d.shiftStatus === 'available';
                return (
                  <div
                    key={d.driverId}
                    className={cn(
                      'flex items-center gap-3 rounded-[10px] border p-3 transition-colors',
                      isAvailable
                        ? 'border-ok/30 bg-ok/5 hover:border-ok/50'
                        : 'border-divider bg-bg-surface-elevated/20',
                      d.driverId === 'drv-001' && simStatus !== 'idle'
                        ? 'ring-2 ring-brand-primary/40 bg-brand-primary/5 border-brand-primary/50 shadow-sm'
                        : '',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white',
                        isAvailable ? 'bg-ok' : 'bg-brand-primary',
                      )}
                    >
                      {d.firstName.charAt(0)}
                      {d.lastName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary-on-dark">
                        {d.firstName} {d.lastName}
                      </p>
                      <p className="font-mono text-[10px] text-text-secondary-on-dark/70">
                        Truck #{d.truckUnitNumber}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                        isAvailable
                          ? 'border-ok/40 text-ok'
                          : 'border-divider text-text-secondary-on-dark',
                        d.driverId === 'drv-001' && simStatus !== 'idle' && !isAvailable
                          ? 'border-brand-primary/50 text-brand-primary bg-brand-primary/10 font-bold'
                          : '',
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recently Completed */}
          <section
            id="demo-sidebar-completed"
            className="rounded-[14px] border border-divider bg-bg-surface p-5 shrink-0"
          >
            <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
              Recently Completed
            </h3>
            <ul className="mt-4 divide-y divide-divider rounded-[10px] border border-divider bg-bg-surface-elevated/10">
              {recentlyCompleted.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-mono text-xs font-semibold text-brand-primary">
                    #{job.jobNumber}
                  </span>
                  <span className="flex-1 truncate font-medium">{job.customerName}</span>
                  <span className="text-xs text-text-secondary-on-dark">{job.driverName}</span>
                  <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ok">
                    Completed
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="lg:col-span-9 h-full">
          <DemoMapPane
            roster={DEMO_DRIVERS}
            jobs={DEMO_JOBS}
            mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || null}
            onSimUpdate={setSimStatus}
          />
        </div>
      </div>
    </div>
  );
}
