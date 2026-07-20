'use client';
import { useUser } from '@/components/app-shell/session-provider';
import type { LienCaseDto, LienCaseStatus, LienState } from '@ustowdispatch/shared';
import { lienStateValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';
import { STATUS_LABEL, STATUS_TONE, STEP_LABEL, dueTone, formatDay } from './lien-ui-helpers';

interface Props {
  cases: LienCaseDto[];
  status: LienCaseStatus | null;
  state: string | null;
  dueSoon: boolean;
}

const FILTERS: { label: string; status: LienCaseStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Open', status: 'open' },
  { label: 'Ready for sale', status: 'ready_for_sale' },
  { label: 'Sold', status: 'sold' },
  { label: 'Closed', status: 'closed' },
  { label: 'Canceled', status: 'canceled' },
];

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function LienCaseListClient({ cases, status, state, dueSoon }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);

  function navigate(next: {
    status?: LienCaseStatus | null;
    state?: string | null;
    due?: boolean;
  }): void {
    const qs = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const st = next.state === undefined ? state : next.state;
    const d = next.due === undefined ? dueSoon : next.due;
    if (s) qs.set('status', s);
    if (st) qs.set('state', st);
    if (d) qs.set('dueSoon', 'true');
    startTransition(() => {
      router.push(qs.toString() ? `/lien-cases?${qs.toString()}` : '/lien-cases');
    });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lien Cases</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Statutory lien-sale workflow for unclaimed impounded vehicles — notices, waiting
            periods, and the ready-for-sale gate.
          </p>
        </div>
        {canWrite && (
          <Link
            href="/lien-cases/new"
            className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold whitespace-nowrap"
          >
            Open lien case
          </Link>
        )}
      </header>

      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter lien cases">
        {FILTERS.map((f) => {
          const active = (status ?? null) === f.status;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => navigate({ status: f.status })}
              disabled={pending}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                active
                  ? 'bg-accent-orange text-white border-accent-orange'
                  : 'border-border-on-dark text-text-secondary-on-dark hover:text-text-primary-on-dark'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-border-on-dark" aria-hidden />
        <label className="text-sm text-text-secondary-on-dark">
          <span className="sr-only">Filter by state</span>
          <select
            value={state ?? ''}
            disabled={pending}
            onChange={(e) => navigate({ state: e.target.value || null })}
            className="bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5 text-sm"
          >
            <option value="">All states</option>
            {lienStateValues.map((s: LienState) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text-secondary-on-dark ml-1">
          <input
            type="checkbox"
            checked={dueSoon}
            disabled={pending}
            onChange={(e) => navigate({ due: e.target.checked })}
          />
          Action due
        </label>
      </nav>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Case</th>
              <th className="text-left px-4 py-2.5">State</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Step</th>
              <th className="text-left px-4 py-2.5">Next action due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No lien cases in this view yet.
                </td>
              </tr>
            )}
            {cases.map((c) => (
              <tr key={c.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/lien-cases/${c.id}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    Case {c.id.slice(0, 8)}
                  </Link>
                  <div className="text-[11px] text-text-secondary-on-dark">
                    Opened {formatDay(c.openedAt)} - {c.vehicleValueTier} value
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs font-semibold">{c.state}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {STEP_LABEL[c.currentStep]}
                </td>
                <td className={`px-4 py-2.5 text-xs ${dueTone(c.nextActionDueAt)}`}>
                  {formatDay(c.nextActionDueAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/lien-cases/${c.id}`} className="text-accent-orange text-xs">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
