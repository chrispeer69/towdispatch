'use client';
import { useUser } from '@/components/app-shell/session-provider';
import { clientRecordDispute, clientReviewJob, clientScoreJob } from '@/lib/api/fraud-client';
import type { DisputeType, JobRiskDetailDto } from '@ustowdispatch/shared';
import { disputeTypeValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import {
  BAND_LABEL,
  BAND_TONE,
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  SEVERITY_TONE,
  SIGNAL_LABEL,
  formatCents,
  formatDateTime,
  formatDay,
  scoreTone,
} from '../fraud-ui-helpers';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function FraudJobDetailClient({ detail }: { detail: JobRiskDetailDto }): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { job, score, signals, disputes } = detail;

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/fraud" className="text-accent-orange text-sm">
            ← Fraud risk
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Job {job.jobNumber}</h1>
          <p className="text-text-secondary-on-dark text-sm mt-0.5">
            {job.serviceType} - {job.motorClubName ?? 'No motor club'} -{' '}
            {job.customerName ?? 'No customer'}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => clientScoreJob(job.jobId))}
            className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50 whitespace-nowrap"
          >
            {score ? 'Re-score' : 'Score job'}
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
          {error}
        </div>
      )}

      {/* Score panel */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        {score ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`text-5xl font-mono font-bold ${scoreTone(score.score0100)}`}>
                {score.score0100}
              </div>
              <div>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${BAND_TONE[score.riskBand]}`}
                >
                  {BAND_LABEL[score.riskBand]} risk
                </span>
                <p className="text-[11px] text-text-secondary-on-dark mt-1">
                  Scored {formatDateTime(score.computedAt)} - {score.modelVersion}
                </p>
                {score.reviewAction && (
                  <p className="text-[11px] text-text-secondary-on-dark">
                    Reviewed: {score.reviewAction.replace(/_/g, ' ')}{' '}
                    {score.reviewedAt ? `(${formatDay(score.reviewedAt)})` : ''}
                  </p>
                )}
              </div>
            </div>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => clientReviewJob(job.jobId, { reviewAction: 'reviewed' }))
                  }
                  className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
                >
                  Mark reviewed
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => clientReviewJob(job.jobId, { reviewAction: 'hold_invoice' }))
                  }
                  className="px-3 py-1.5 rounded-md border border-accent-orange/40 text-accent-orange text-sm disabled:opacity-50"
                >
                  Hold invoice
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => clientReviewJob(job.jobId, { reviewAction: 'escalate' }))
                  }
                  className="px-3 py-1.5 rounded-md border border-status-warning/40 text-status-warning text-sm disabled:opacity-50"
                >
                  Escalate
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary-on-dark">
            This job has not been scored yet.{canWrite ? ' Use “Score job” above.' : ''}
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Signals */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
          <h2 className="font-semibold mb-3">Risk signals</h2>
          {signals.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">No signals fired.</p>
          ) : (
            <ul className="space-y-2">
              {signals.map((s) => (
                <li key={s.id} className="border-b border-border-on-dark pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium ${SEVERITY_TONE[s.severity]}`}>
                      {SIGNAL_LABEL[s.signalType]}
                    </span>
                    <span className="text-[11px] text-text-secondary-on-dark uppercase">
                      {s.severity} - {s.confidencePct}%
                    </span>
                  </div>
                  <pre className="mt-1 text-[11px] text-text-secondary-on-dark whitespace-pre-wrap break-all">
                    {JSON.stringify(s.payload)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Job context */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
          <h2 className="font-semibold mb-3">Job</h2>
          <Field label="Job number" value={job.jobNumber} />
          <Field label="Service" value={job.serviceType} />
          <Field label="Status" value={job.status} />
          <Field label="Motor club" value={job.motorClubName ?? '—'} />
          <Field label="Customer" value={job.customerName ?? '—'} />
          <Field label="VIN" value={job.vehicleVin ?? '—'} />
          <Field label="Invoice total" value={formatCents(job.invoiceTotalCents)} />
          <Field label="Created" value={formatDay(job.createdAt)} />
        </div>
      </div>

      {/* Record a dispute */}
      {canWrite && (
        <RecordDisputeForm
          busy={busy}
          defaultClub={job.motorClubName ?? ''}
          onSubmit={(body) => run(() => clientRecordDispute({ jobId: job.jobId, ...body }))}
        />
      )}

      {/* Disputes on this job */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Disputes</h2>
        {disputes.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No disputes logged for this job.</p>
        ) : (
          <ul className="space-y-2">
            {disputes.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 border-b border-border-on-dark pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {d.motorClubName} - {d.disputeType}
                  </p>
                  <p className="text-[11px] text-text-secondary-on-dark">
                    {formatCents(d.amountDisputedCents)} - disputed {formatDay(d.disputedAt)}
                  </p>
                </div>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${DISPUTE_STATUS_TONE[d.status]}`}
                >
                  {DISPUTE_STATUS_LABEL[d.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-text-secondary-on-dark">
          Resolve disputes + record outcomes on the{' '}
          <Link href="/fraud/disputes" className="text-accent-orange">
            dispute log
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-text-secondary-on-dark">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function RecordDisputeForm({
  busy,
  defaultClub,
  onSubmit,
}: {
  busy: boolean;
  defaultClub: string;
  onSubmit: (body: {
    motorClubName: string;
    disputeType: DisputeType;
    amountDisputedCents?: number;
  }) => void;
}): JSX.Element {
  const [club, setClub] = useState(defaultClub);
  const [disputeType, setDisputeType] = useState<DisputeType>('pricing');
  const [amount, setAmount] = useState('');

  return (
    <form
      className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!club) return;
        const cents = amount ? Math.round(Number.parseFloat(amount) * 100) : undefined;
        onSubmit({
          motorClubName: club,
          disputeType,
          ...(cents !== undefined && !Number.isNaN(cents) ? { amountDisputedCents: cents } : {}),
        });
      }}
    >
      <h2 className="font-semibold mb-3">Log a dispute</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Motor club</span>
          <input
            value={club}
            onChange={(e) => setClub(e.target.value)}
            required
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Type</span>
          <select
            value={disputeType}
            onChange={(e) => setDisputeType(e.target.value as DisputeType)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          >
            {disputeTypeValues.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Amount ($, optional)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        Log dispute
      </button>
    </form>
  );
}
