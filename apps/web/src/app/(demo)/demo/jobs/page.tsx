'use client';

/**
 * Demo jobs list — shows all mock jobs in a table format.
 */

import { cn } from '@/lib/utils';
import { Truck } from 'lucide-react';
import { DEMO_JOBS } from '../mock-data';

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

const STATUS_TONE: Record<string, string> = {
  new: 'border-info/30 bg-info/10 text-info',
  dispatched: 'border-info/30 bg-info/10 text-info',
  enroute: 'border-warn/30 bg-warn/10 text-warn',
  on_scene: 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary',
  in_progress: 'border-violet/30 bg-violet/10 text-violet',
  completed: 'border-ok/30 bg-ok/10 text-ok',
  cancelled: 'border-danger/30 bg-danger/10 text-danger',
  goa: 'border-text-secondary-on-dark/30 bg-text-secondary-on-dark/10 text-text-secondary-on-dark',
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DemoJobsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-brand-primary" />
          <div>
            <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
              Tow Jobs
            </h1>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              {DEMO_JOBS.length} jobs - Demo data
            </p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-[10px] bg-brand-primary-hover px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary"
        >
          + New Call
        </button>
      </header>

      <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface-elevated/30">
            <tr className="text-left">
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Job #
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Customer
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Service
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Vehicle
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Driver
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Status
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Amount
              </th>
              <th className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {DEMO_JOBS.map((job) => (
              <tr key={job.id} className="transition-colors hover:bg-bg-surface-elevated/20">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-primary">
                  #{job.jobNumber}
                </td>
                <td className="px-4 py-3 font-medium">{job.customerName}</td>
                <td className="px-4 py-3 text-text-secondary-on-dark">
                  {SERVICE_LABEL[job.serviceType] ?? job.serviceType}
                </td>
                <td className="px-4 py-3 text-xs text-text-secondary-on-dark">{job.vehicleDesc}</td>
                <td className="px-4 py-3 text-text-secondary-on-dark">
                  {job.driverName ?? (
                    <span className="italic text-text-secondary-on-dark/50">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                      STATUS_TONE[job.status] ?? 'border-divider text-text-secondary-on-dark',
                    )}
                  >
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs font-semibold tabular-nums text-text-primary-on-dark">
                  {currencyFormatter.format(job.amountCents / 100)}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-text-secondary-on-dark/70">
                  {formatTime(job.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-divider px-4 py-2 text-[11px] text-text-secondary-on-dark/60">
          Showing {DEMO_JOBS.length} demo jobs - Sign up to create real jobs
        </div>
      </div>
    </div>
  );
}
