/**
 * /active-etas — drill-down from the Avg ETA tile. Lists every active job
 * sorted longest-projected-time-first so dispatch can see who is at risk of
 * blowing past 60 minutes (or past the account's SLA) and intervene. Breached
 * accounts are pulled out at the top so reorg is one glance away.
 */
import { JobLink } from '@/components/ui/entity-link';
import { apiServer, tryFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { JobServiceType, JobStatus } from '@ustowdispatch/shared';
import { AlertTriangle, Clock } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'ETA Triage — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface EtaBoardItem {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
  serviceType: JobServiceType;
  accountId: string | null;
  accountName: string | null;
  slaMinutes: number | null;
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
  assignedAt: string | null;
  etaToSceneMinutes: number | null;
  elapsedMinutes: number;
  totalProjectedMinutes: number | null;
  breached: boolean;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  new: 'New',
  dispatched: 'Dispatched',
  enroute: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  goa: 'GOA',
};

const SERVICE_LABEL: Record<JobServiceType, string> = {
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

function formatMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  return `${m} min`;
}

export default async function EtaTriagePage(): Promise<JSX.Element> {
  const res = await tryFetch(() => apiServer<EtaBoardItem[]>('/dashboard/eta-board'));
  const items = res.data ?? [];

  const breached = items.filter((i) => i.breached);
  const onTrack = items.filter((i) => !i.breached);

  // Roll up breaches per account so the dispatcher can see "which clients did
  // we miss the ETA on" at a glance — the goal is no jobs past 60 min.
  const breachByAccount = new Map<
    string,
    { accountId: string | null; accountName: string; count: number; worstMinutes: number }
  >();
  for (const b of breached) {
    const key = b.accountId ?? '__cash__';
    const name = b.accountName ?? 'Cash / No account';
    const existing = breachByAccount.get(key);
    const worst = b.totalProjectedMinutes ?? b.elapsedMinutes;
    if (existing) {
      existing.count += 1;
      if (worst > existing.worstMinutes) existing.worstMinutes = worst;
    } else {
      breachByAccount.set(key, {
        accountId: b.accountId,
        accountName: name,
        count: 1,
        worstMinutes: worst,
      });
    }
  }
  const breachRollup = Array.from(breachByAccount.values()).sort(
    (a, b) => b.worstMinutes - a.worstMinutes,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          <Link href="/dashboard" className="hover:text-text-primary-on-dark">
            ← Operations Overview
          </Link>
        </p>
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            ETA Triage
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            <span className="font-condensed text-base font-extrabold text-text-primary-on-dark">
              {items.length}
            </span>{' '}
            active {items.length === 1 ? 'call' : 'calls'} · longest projected time first · goal: no
            job past 60 min
          </p>
        </div>
      </header>

      {breachRollup.length > 0 ? (
        <section className="rounded-[14px] border border-warning/40 bg-warning/5 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-warning">
              SLA breaches — accounts to manage now
            </h2>
          </div>
          <p className="mt-1 text-xs text-text-secondary-on-dark">
            {breached.length} job{breached.length === 1 ? '' : 's'} past target across{' '}
            {breachRollup.length} client{breachRollup.length === 1 ? '' : 's'}.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {breachRollup.map((r) => (
              <li
                key={r.accountId ?? 'cash'}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-warning/30 bg-bg-surface px-3 py-2"
              >
                <span className="truncate font-medium">{r.accountName}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-warning">
                    {r.count} breach{r.count === 1 ? '' : 'es'}
                  </span>
                  <span className="font-mono text-xs font-bold text-warning">
                    {formatMinutes(r.worstMinutes)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-center">
          <Clock className="h-8 w-8 text-text-secondary-on-dark/40" />
          <p className="mt-2 font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            No active calls right now.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface-elevated/30">
              <tr className="text-left">
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Projected
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Job
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Client
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Driver
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Service
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Status
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Elapsed
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  ETA→scene
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  SLA
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {[...breached, ...onTrack].map((i) => (
                <tr
                  key={i.jobId}
                  className={cn(
                    'hover:bg-bg-surface-elevated/20',
                    i.breached ? 'bg-warning/5' : '',
                  )}
                >
                  <td
                    className={cn(
                      'px-4 py-2 font-mono text-sm font-bold tabular-nums',
                      i.breached ? 'text-warning' : 'text-text-primary-on-dark',
                    )}
                  >
                    {formatMinutes(i.totalProjectedMinutes ?? i.elapsedMinutes)}
                  </td>
                  <td className="px-4 py-2 font-medium">
                    <JobLink jobId={i.jobId}>#{i.jobNumber}</JobLink>
                  </td>
                  <td className="px-4 py-2">
                    {i.accountId ? (
                      <Link
                        href={`/active-calls/${i.accountId}`}
                        className="hover:text-brand-primary hover:underline underline-offset-2"
                      >
                        {i.accountName}
                      </Link>
                    ) : (
                      <span className="italic text-text-secondary-on-dark">Cash / no account</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-secondary-on-dark">
                    {i.driverName ?? <span className="italic">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2 text-text-secondary-on-dark">
                    {SERVICE_LABEL[i.serviceType]}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full border border-divider bg-bg-surface-elevated/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                      {STATUS_LABEL[i.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                    {formatMinutes(i.elapsedMinutes)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                    {i.etaToSceneMinutes === null ? '—' : formatMinutes(i.etaToSceneMinutes)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                    {i.slaMinutes ? `${i.slaMinutes} min` : '60 min*'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-divider px-4 py-2 text-[11px] text-text-secondary-on-dark/60">
            * No account SLA set — comparing against the 60-minute house target.
          </p>
        </div>
      )}
    </div>
  );
}
