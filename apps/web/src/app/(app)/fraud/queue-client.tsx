'use client';
import type { FraudRiskBand, HighRiskListItemDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';
import { BAND_LABEL, BAND_TONE, formatCents, formatDay, scoreTone } from './fraud-ui-helpers';

interface Props {
  items: HighRiskListItemDto[];
  band: FraudRiskBand | null;
}

const FILTERS: { label: string; band: FraudRiskBand | null }[] = [
  { label: 'High + critical', band: null },
  { label: 'Critical', band: 'critical' },
  { label: 'High', band: 'high' },
  { label: 'Medium', band: 'medium' },
  { label: 'Low', band: 'low' },
];

export function FraudQueueClient({ items, band }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(next: FraudRiskBand | null): void {
    const qs = new URLSearchParams();
    if (next) qs.set('band', next);
    startTransition(() => {
      router.push(qs.toString() ? `/fraud?${qs.toString()}` : '/fraud');
    });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fraud Risk Queue</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Jobs scored high or critical risk in the last 30 days. Advisory only — scoring never
            blocks an invoice.
          </p>
        </div>
        <Link href="/fraud/disputes" className="text-accent-orange text-sm whitespace-nowrap">
          Dispute log →
        </Link>
      </header>

      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter by risk band">
        {FILTERS.map((f) => {
          const active = (band ?? null) === f.band;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => navigate(f.band)}
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
              <th className="text-left px-4 py-2.5">Job</th>
              <th className="text-left px-4 py-2.5">Motor club</th>
              <th className="text-left px-4 py-2.5">Score</th>
              <th className="text-left px-4 py-2.5">Band</th>
              <th className="text-left px-4 py-2.5">Invoice</th>
              <th className="text-left px-4 py-2.5">Scored</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No jobs in this risk view yet.
                </td>
              </tr>
            )}
            {items.map(({ score, job }) => (
              <tr key={job.jobId} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/fraud/${job.jobId}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    {job.jobNumber}
                  </Link>
                  <div className="text-[11px] text-text-secondary-on-dark">
                    {job.serviceType} · {job.customerName ?? 'No customer'}
                    {score.reviewAction ? ` · reviewed (${score.reviewAction})` : ''}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">{job.motorClubName ?? '—'}</td>
                <td className={`px-4 py-2.5 font-mono font-semibold ${scoreTone(score.score0100)}`}>
                  {score.score0100}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${BAND_TONE[score.riskBand]}`}
                  >
                    {BAND_LABEL[score.riskBand]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">{formatCents(job.invoiceTotalCents)}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {formatDay(score.computedAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/fraud/${job.jobId}`} className="text-accent-orange text-xs">
                    Review →
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
