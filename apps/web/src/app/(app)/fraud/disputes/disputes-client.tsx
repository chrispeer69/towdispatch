'use client';
import { useUser } from '@/components/app-shell/session-provider';
import { clientRecordOutcome, clientResolveDispute } from '@/lib/api/fraud-client';
import type {
  DisputeRecordDto,
  DisputeResolutionStatus,
  DisputeStatus,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, type JSX, useState } from 'react';
import {
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  formatCents,
  formatDay,
} from '../fraud-ui-helpers';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

const FILTERS: { label: string; status: DisputeStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Open', status: 'open' },
  { label: 'Won', status: 'won' },
  { label: 'Lost', status: 'lost' },
  { label: 'Partial', status: 'partial' },
  { label: 'Withdrawn', status: 'withdrawn' },
];

interface Props {
  disputes: DisputeRecordDto[];
  status: DisputeStatus | null;
}

export function FraudDisputesClient({ disputes, status }: Props): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOpenRow(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: DisputeStatus | null): void {
    const qs = new URLSearchParams();
    if (next) qs.set('status', next);
    router.push(qs.toString() ? `/fraud/disputes?${qs.toString()}` : '/fraud/disputes');
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispute Log</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Motor-club disputes (last 90 days). Resolve a dispute and record whether it was fraud to
            feed the model.
          </p>
        </div>
        <div className="flex gap-4 whitespace-nowrap">
          <Link href="/fraud" className="text-accent-orange text-sm">
            ← Risk queue
          </Link>
          <Link href="/fraud/reports" className="text-accent-orange text-sm">
            Reports →
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
          {error}
        </div>
      )}

      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter disputes">
        {FILTERS.map((f) => {
          const active = (status ?? null) === f.status;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => navigate(f.status)}
              disabled={busy}
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
              <th className="text-left px-4 py-2.5">Motor club</th>
              <th className="text-left px-4 py-2.5">Type</th>
              <th className="text-left px-4 py-2.5">Disputed</th>
              <th className="text-left px-4 py-2.5">Amount</th>
              <th className="text-left px-4 py-2.5">Recovered</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {disputes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No disputes in this view.
                </td>
              </tr>
            )}
            {disputes.map((d) => (
              <Fragment key={d.id}>
                <tr className="border-t border-border-on-dark hover:bg-bg-base/30">
                  <td className="px-4 py-2.5 font-semibold">
                    <Link href={`/fraud/${d.jobId}`} className="hover:text-accent-orange">
                      {d.motorClubName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{d.disputeType}</td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {formatDay(d.disputedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{formatCents(d.amountDisputedCents)}</td>
                  <td className="px-4 py-2.5 text-xs">{formatCents(d.resolutionAmountCents)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${DISPUTE_STATUS_TONE[d.status]}`}
                    >
                      {DISPUTE_STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => setOpenRow(openRow === d.id ? null : d.id)}
                        className="text-accent-orange text-xs"
                      >
                        {d.status === 'open' ? 'Resolve' : 'Outcome'} →
                      </button>
                    )}
                  </td>
                </tr>
                {canWrite && openRow === d.id && (
                  <tr className="border-t border-border-on-dark bg-bg-base/20">
                    <td colSpan={7} className="px-4 py-3">
                      <DisputeActions
                        dispute={d}
                        busy={busy}
                        onResolve={(status, recoveredCents) =>
                          run(() =>
                            clientResolveDispute(d.id, {
                              status,
                              ...(recoveredCents !== undefined
                                ? { resolutionAmountCents: recoveredCents }
                                : {}),
                            }),
                          )
                        }
                        onOutcome={(wasFraud) => run(() => clientRecordOutcome(d.id, { wasFraud }))}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DisputeActions({
  dispute,
  busy,
  onResolve,
  onOutcome,
}: {
  dispute: DisputeRecordDto;
  busy: boolean;
  onResolve: (status: DisputeResolutionStatus, recoveredCents?: number) => void;
  onOutcome: (wasFraud: boolean) => void;
}): JSX.Element {
  const [recovered, setRecovered] = useState('');
  const resolved = dispute.status !== 'open';
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {!resolved ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Recovered ($, optional)</span>
            <input
              value={recovered}
              onChange={(e) => setRecovered(e.target.value)}
              inputMode="decimal"
              className="bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          {(['won', 'lost', 'partial', 'withdrawn'] as DisputeResolutionStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => {
                const cents = recovered
                  ? Math.round(Number.parseFloat(recovered) * 100)
                  : undefined;
                onResolve(s, cents !== undefined && !Number.isNaN(cents) ? cents : undefined);
              }}
              className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm capitalize disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-secondary-on-dark">
          Resolved {formatDay(dispute.resolutionAt)}. Record ground truth:
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onOutcome(true)}
          className="px-3 py-1.5 rounded-md border border-status-warning/40 text-status-warning text-sm disabled:opacity-50"
        >
          Was fraud
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOutcome(false)}
          className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
        >
          Not fraud
        </button>
      </div>
    </div>
  );
}
