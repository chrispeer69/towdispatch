'use client';
import { useUser } from '@/components/app-shell/session-provider';
import { useTenantFormatters } from '@/lib/i18n/formatters';
import type { ImpoundRecordDto, ImpoundRecordStatus, ImpoundYardDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';
import { STATUS_LABEL, STATUS_TONE, formatDate, vehicleLabel } from './impound-ui-helpers';

interface Props {
  records: ImpoundRecordDto[];
  yards: ImpoundYardDto[];
  status: ImpoundRecordStatus | null;
  yardId: string | null;
  lienOnly: boolean;
}

const FILTERS: { label: string; status: ImpoundRecordStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Stored', status: 'stored' },
  { label: 'Pending release', status: 'pending_release' },
  { label: 'Released', status: 'released' },
  { label: 'Transferred', status: 'transferred' },
  { label: 'Disposed', status: 'disposed' },
];

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function ImpoundListClient({
  records,
  yards,
  status,
  yardId,
  lienOnly,
}: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const user = useUser();
  // Canada Expansion (S47): money formatted in the tenant's currency/locale.
  const fmt = useTenantFormatters();
  const canWrite = WRITER_ROLES.has(user.role);
  const yardName = (id: string): string => yards.find((y) => y.id === id)?.name ?? '—';

  function navigate(next: {
    status?: ImpoundRecordStatus | null;
    yardId?: string | null;
    lien?: boolean;
  }): void {
    const qs = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const y = next.yardId === undefined ? yardId : next.yardId;
    const l = next.lien === undefined ? lienOnly : next.lien;
    if (s) qs.set('status', s);
    if (y) qs.set('yardId', y);
    if (l) qs.set('lienEligible', 'true');
    startTransition(() => {
      router.push(qs.toString() ? `/impound?${qs.toString()}` : '/impound');
    });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Impound &amp; Storage</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Track impounded vehicles, holds, daily storage fees, and the documented release
            workflow.
          </p>
        </div>
        {canWrite && (
          <Link
            href="/impound/new"
            className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold whitespace-nowrap"
          >
            New intake
          </Link>
        )}
      </header>

      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter records">
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
          <span className="sr-only">Filter by yard</span>
          <select
            value={yardId ?? ''}
            disabled={pending}
            onChange={(e) => navigate({ yardId: e.target.value || null })}
            className="bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5 text-sm"
          >
            <option value="">All yards</option>
            {yards.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text-secondary-on-dark ml-1">
          <input
            type="checkbox"
            checked={lienOnly}
            disabled={pending}
            onChange={(e) => navigate({ lien: e.target.checked })}
          />
          Lien-eligible only
        </label>
      </nav>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Vehicle</th>
              <th className="text-left px-4 py-2.5">Yard</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Arrived</th>
              <th className="text-right px-4 py-2.5">Accrued</th>
              <th className="text-left px-4 py-2.5">Lien</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No impound records in this view yet.
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/impound/${r.id}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    {vehicleLabel(r)}
                  </Link>
                  <div className="text-[11px] text-text-secondary-on-dark">
                    {r.licensePlate
                      ? `${r.licensePlate}${r.licenseState ? ` · ${r.licenseState}` : ''}`
                      : (r.vehicleVin ?? '—')}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">{yardName(r.yardId)}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {formatDate(r.arrivedAt)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt.money(r.accruedFeeCents)}
                </td>
                <td className="px-4 py-2.5">
                  {r.lienEligible ? (
                    <span className="text-[11px] font-semibold uppercase text-status-warning">
                      Eligible
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-secondary-on-dark">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/impound/${r.id}`} className="text-accent-orange text-xs">
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
