'use client';
import { useUser } from '@/components/app-shell/session-provider';
import type { RepoCaseDto, RepoCaseStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';
import { formatDay } from '../../lien-cases/lien-ui-helpers';

interface Props {
  cases: RepoCaseDto[];
  status: RepoCaseStatus | null;
  lienholderId: string | null;
}

const REPO_STATUS_LABEL: Record<RepoCaseStatus, string> = {
  open: 'Open',
  located: 'Located',
  recovered: 'Recovered',
  surrendered: 'Surrendered',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const REPO_STATUS_TONE: Record<RepoCaseStatus, string> = {
  open: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  located: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  recovered:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  surrendered:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  closed: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  cancelled: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark line-through',
};

function vehicleDescription(c: RepoCaseDto): string {
  const d = [c.vehicleYear, c.vehicleColor, c.vehicleMake, c.vehicleModel]
    .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
    .join(' ');
  return d || '—';
}

const FILTERS: { label: string; status: RepoCaseStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Open', status: 'open' },
  { label: 'Located', status: 'located' },
  { label: 'Recovered', status: 'recovered' },
  { label: 'Surrendered', status: 'surrendered' },
  { label: 'Closed', status: 'closed' },
  { label: 'Cancelled', status: 'cancelled' },
];

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function RepoCaseListClient({ cases, status, lienholderId }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);

  function navigate(next: { status?: RepoCaseStatus | null }): void {
    const qs = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    if (s) qs.set('status', s);
    if (lienholderId) qs.set('lienholderId', lienholderId);
    startTransition(() => {
      router.push(qs.toString() ? `/repo/cases?${qs.toString()}` : '/repo/cases');
    });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repo Cases</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Repossession assignments from lienholders — locate, attempt, recover, and close.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Link
              href="/repo/lienholders"
              className="px-4 py-2 rounded-md border border-border-on-dark text-text-secondary-on-dark font-semibold whitespace-nowrap hover:text-text-primary-on-dark"
            >
              Lienholders
            </Link>
            <Link
              href="/repo/cases/new"
              className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold whitespace-nowrap"
            >
              New case
            </Link>
          </div>
        )}
      </header>

      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter repo cases">
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
      </nav>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Case</th>
              <th className="text-left px-4 py-2.5">Vehicle</th>
              <th className="text-left px-4 py-2.5">Debtor</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Assigned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No repo cases in this view yet.
                </td>
              </tr>
            )}
            {cases.map((c) => (
              <tr key={c.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/repo/cases/${c.id}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    {c.caseNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {vehicleDescription(c)}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {c.debtorName ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${REPO_STATUS_TONE[c.status]}`}
                  >
                    {REPO_STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {formatDay(c.assignedAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/repo/cases/${c.id}`} className="text-accent-orange text-xs">
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
