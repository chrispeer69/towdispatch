'use client';
import { useUser } from '@/components/app-shell/session-provider';
import {
  clientCloseRepoCase,
  clientMarkLocated,
  clientPreviewRepoInvoice,
  clientRecordAttempt,
  clientRecordRecovery,
  clientReleasePersonalProperty,
} from '@/lib/api/repo-client';
import type {
  RepoAttemptOutcome,
  RepoCaseDetailDto,
  RepoCaseStatus,
  RepoCloseDisposition,
  RepoConditionPhotoType,
  RepoInvoicePreviewDto,
  RepoRecoveryType,
} from '@ustowdispatch/shared';
import {
  repoAttemptOutcomeValues,
  repoCloseDispositionValues,
  repoRecoveryTypeValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import { formatCents, formatDate, formatDay } from '../../../lien-cases/lien-ui-helpers';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const TERMINAL: ReadonlySet<RepoCaseStatus> = new Set(['closed', 'cancelled']);

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

const ATTEMPT_OUTCOME_LABEL: Record<RepoAttemptOutcome, string> = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  spotted_no_attempt: 'Spotted, no attempt',
  attempted_failed: 'Attempted, failed',
  peaceful_recovery: 'Peaceful recovery',
  surrendered: 'Surrendered',
};

const RECOVERY_TYPE_LABEL: Record<RepoRecoveryType, string> = {
  peaceful: 'Peaceful',
  voluntary_surrender: 'Voluntary surrender',
  involuntary_impound: 'Involuntary impound',
};

const PHOTO_TYPE_LABEL: Record<RepoConditionPhotoType, string> = {
  exterior_front: 'Exterior front',
  exterior_rear: 'Exterior rear',
  exterior_left: 'Exterior left',
  exterior_right: 'Exterior right',
  interior: 'Interior',
  odometer: 'Odometer',
  damage: 'Damage',
  vin_plate: 'VIN plate',
  other: 'Other',
};

function vehicleDescription(c: RepoCaseDetailDto['case']): string {
  const d = [c.vehicleYear, c.vehicleColor, c.vehicleMake, c.vehicleModel]
    .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
    .join(' ');
  return d || 'Unidentified vehicle';
}

export function RepoCaseDetailClient({ detail }: { detail: RepoCaseDetailDto }): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = detail.case;
  const lh = detail.lienholder;
  const active = !TERMINAL.has(c.status);
  const canAttempt = c.status === 'open' || c.status === 'located';

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
          <Link href="/repo/cases" className="text-accent-orange text-sm">
            ← Repo cases
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{vehicleDescription(c)}</h1>
          <p className="text-text-secondary-on-dark text-sm mt-0.5">
            {c.caseNumber} ·{' '}
            <span
              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${REPO_STATUS_TONE[c.status]}`}
            >
              {REPO_STATUS_LABEL[c.status]}
            </span>
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
          {error}
        </div>
      )}

      {/* Writer action bar */}
      {canWrite && active && (
        <div className="flex flex-wrap gap-2">
          {c.status === 'open' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => clientMarkLocated(c.id, {}))}
              className="px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
            >
              Mark located
            </button>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Case + vehicle + debtor */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
          <h2 className="font-semibold mb-3">Case</h2>
          <Field label="VIN" value={c.vin ?? '—'} />
          <Field label="Plate" value={c.plate ?? '—'} />
          <Field label="Debtor" value={c.debtorName ?? '—'} />
          <Field label="Debtor address" value={c.debtorAddress ?? '—'} />
          <Field label="Debtor phone" value={c.debtorPhone ?? '—'} />
          <hr className="my-3 border-border-on-dark" />
          <Field
            label="Redemption window"
            value={c.redemptionWindowDays !== null ? `${c.redemptionWindowDays} days` : '—'}
          />
          <Field label="Redemption ends" value={formatDay(c.redemptionEndsAt)} />
          <Field label="Assigned" value={formatDate(c.assignedAt)} />
          <Field label="Located" value={formatDate(c.locatedAt)} />
          <Field label="Recovered" value={formatDate(c.recoveredAt)} />
          <Field label="Closed" value={formatDate(c.closedAt)} />
          {c.notes && (
            <>
              <hr className="my-3 border-border-on-dark" />
              <p className="text-sm text-text-secondary-on-dark whitespace-pre-wrap">{c.notes}</p>
            </>
          )}
        </div>

        {/* Lienholder contact */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
          <h2 className="font-semibold mb-3">Lienholder</h2>
          <Field label="Name" value={lh.name} />
          <Field label="Contact" value={lh.contactName ?? '—'} />
          <Field label="Phone" value={lh.phone ?? '—'} />
          <Field label="Email" value={lh.email ?? '—'} />
          <Field
            label="Address"
            value={
              [lh.addressLine1, lh.addressLine2, lh.city, lh.state, lh.postalCode]
                .filter((p) => p && `${p}`.length > 0)
                .join(', ') || '—'
            }
          />
          <Field label="Invoice format" value={lh.invoiceFormat} />
        </div>
      </div>

      {/* Writer action forms */}
      {canWrite && canAttempt && (
        <div className="grid gap-6 md:grid-cols-2">
          <RecordAttemptForm
            busy={busy}
            onSubmit={(body) => run(() => clientRecordAttempt(c.id, body))}
          />
          <RecordRecoveryForm
            busy={busy}
            onSubmit={(body) => run(() => clientRecordRecovery(c.id, body))}
          />
        </div>
      )}

      {/* Attempts log */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Location attempts ({detail.attemptCount})</h2>
        {detail.attempts.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No attempts recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left py-1.5">When</th>
                <th className="text-left py-1.5">Outcome</th>
                <th className="text-left py-1.5">Address</th>
                <th className="text-left py-1.5">Notes</th>
              </tr>
            </thead>
            <tbody>
              {detail.attempts.map((a) => (
                <tr key={a.id} className="border-t border-border-on-dark">
                  <td className="py-1.5 text-text-secondary-on-dark whitespace-nowrap">
                    {formatDate(a.attemptedAt)}
                  </td>
                  <td className="py-1.5">{ATTEMPT_OUTCOME_LABEL[a.outcome]}</td>
                  <td className="py-1.5 text-text-secondary-on-dark">{a.address ?? '—'}</td>
                  <td className="py-1.5 text-text-secondary-on-dark">{a.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recovery events */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Recovery events</h2>
        {detail.recoveryEvents.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No recovery recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.recoveryEvents.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-border-on-dark pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{RECOVERY_TYPE_LABEL[r.recoveryType]}</p>
                  <p className="text-[11px] text-text-secondary-on-dark">
                    {formatDate(r.recoveredAt)}
                    {r.odometer !== null ? ` · ${r.odometer.toLocaleString()} mi` : ''}
                    {r.conditionNotes ? ` · ${r.conditionNotes}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Personal property */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Personal property</h2>
        {detail.personalProperty.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No personal property logged.</p>
        ) : (
          <ul className="space-y-2">
            {detail.personalProperty.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-border-on-dark pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{p.itemDescription}</p>
                  <p className="text-[11px] text-text-secondary-on-dark">
                    Logged {formatDay(p.recordedAt)}
                    {p.releasedAt
                      ? ` · released to ${p.releasedTo ?? '—'} on ${formatDay(p.releasedAt)}`
                      : ''}
                  </p>
                </div>
                {canWrite && !p.releasedAt && (
                  <ReleasePropertyButton
                    busy={busy}
                    onRelease={(releasedTo) =>
                      run(() => clientReleasePersonalProperty(c.id, p.id, { releasedTo }))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Condition photos */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Condition photos</h2>
        {detail.conditionPhotos.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No condition photos uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {detail.conditionPhotos.map((ph) => (
              <figure key={ph.id} className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ph.photoUrl}
                  alt={PHOTO_TYPE_LABEL[ph.photoType]}
                  className="aspect-square w-full rounded-md border border-border-on-dark object-cover"
                />
                <figcaption className="mt-1 text-[11px] text-text-secondary-on-dark">
                  {PHOTO_TYPE_LABEL[ph.photoType]}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {/* Invoice preview */}
      <InvoicePreviewPanel
        onPreview={(body) => clientPreviewRepoInvoice(c.id, body)}
        attemptCount={detail.attemptCount}
      />

      {/* Close panel */}
      {canWrite && active && (
        <ClosePanel
          busy={busy}
          onClose={(disposition, reason) =>
            run(() => clientCloseRepoCase(c.id, reason ? { disposition, reason } : { disposition }))
          }
        />
      )}
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

function RecordAttemptForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: { outcome: RepoAttemptOutcome; address?: string; notes?: string }) => void;
}): JSX.Element {
  const [outcome, setOutcome] = useState<RepoAttemptOutcome>('not_home');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <form
      className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          outcome,
          ...(address ? { address } : {}),
          ...(notes ? { notes } : {}),
        });
      }}
    >
      <h2 className="font-semibold mb-3">Record attempt</h2>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Outcome</span>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as RepoAttemptOutcome)}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        >
          {repoAttemptOutcomeValues.map((o) => (
            <option key={o} value={o}>
              {ATTEMPT_OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Address (optional)</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        />
      </label>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        Record attempt
      </button>
    </form>
  );
}

function RecordRecoveryForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: {
    recoveryType: RepoRecoveryType;
    odometer?: number;
    conditionNotes?: string;
  }) => void;
}): JSX.Element {
  const [recoveryType, setRecoveryType] = useState<RepoRecoveryType>('peaceful');
  const [odometer, setOdometer] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');

  return (
    <form
      className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          recoveryType,
          ...(odometer ? { odometer: Number(odometer) } : {}),
          ...(conditionNotes ? { conditionNotes } : {}),
        });
      }}
    >
      <h2 className="font-semibold mb-3">Record recovery</h2>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Recovery type</span>
        <select
          value={recoveryType}
          onChange={(e) => setRecoveryType(e.target.value as RepoRecoveryType)}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        >
          {repoRecoveryTypeValues.map((t) => (
            <option key={t} value={t}>
              {RECOVERY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Odometer (optional)</span>
        <input
          type="number"
          min="0"
          value={odometer}
          onChange={(e) => setOdometer(e.target.value)}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        />
      </label>
      <label className="block text-sm mb-3">
        <span className="block text-text-secondary-on-dark mb-1">Condition notes (optional)</span>
        <textarea
          value={conditionNotes}
          onChange={(e) => setConditionNotes(e.target.value)}
          rows={2}
          className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        Record recovery
      </button>
    </form>
  );
}

function ReleasePropertyButton({
  busy,
  onRelease,
}: {
  busy: boolean;
  onRelease: (releasedTo: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [releasedTo, setReleasedTo] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 rounded-md border border-border-on-dark text-xs disabled:opacity-50"
      >
        Release
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={releasedTo}
        onChange={(e) => setReleasedTo(e.target.value)}
        placeholder="Released to"
        className="bg-bg-base border border-border-on-dark rounded-md px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={busy || releasedTo.trim().length === 0}
        onClick={() => onRelease(releasedTo.trim())}
        className="px-2.5 py-1 rounded-md bg-accent-orange text-white text-xs disabled:opacity-50"
      >
        Confirm
      </button>
    </div>
  );
}

function ClosePanel({
  busy,
  onClose,
}: {
  busy: boolean;
  onClose: (disposition: RepoCloseDisposition, reason?: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
      <h2 className="font-semibold mb-2">Close case</h2>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5 text-sm mb-2"
      />
      <div className="flex flex-wrap gap-2">
        {repoCloseDispositionValues.map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            onClick={() => onClose(d, reason || undefined)}
            className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
          >
            {d === 'closed' ? 'Close' : 'Cancel case'}
          </button>
        ))}
      </div>
    </div>
  );
}

function InvoicePreviewPanel({
  onPreview,
  attemptCount,
}: {
  onPreview: (body: {
    recoveryFeeCents: number;
    skipTraceFeeCents?: number;
    storageDays?: number;
    storageDailyRateCents?: number;
    attemptFeeCents?: number;
    attemptCount?: number;
  }) => Promise<RepoInvoicePreviewDto>;
  attemptCount: number;
}): JSX.Element {
  const [recoveryFee, setRecoveryFee] = useState('');
  const [skipTraceFee, setSkipTraceFee] = useState('');
  const [storageDays, setStorageDays] = useState('');
  const [storageRate, setStorageRate] = useState('');
  const [attemptFee, setAttemptFee] = useState('');
  const [attemptCnt, setAttemptCnt] = useState(String(attemptCount));
  const [preview, setPreview] = useState<RepoInvoicePreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dollarsToCents = (v: string): number => Math.round(Number(v) * 100);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body = {
        recoveryFeeCents: dollarsToCents(recoveryFee || '0'),
        ...(skipTraceFee ? { skipTraceFeeCents: dollarsToCents(skipTraceFee) } : {}),
        ...(storageDays ? { storageDays: Number(storageDays) } : {}),
        ...(storageRate ? { storageDailyRateCents: dollarsToCents(storageRate) } : {}),
        ...(attemptFee ? { attemptFeeCents: dollarsToCents(attemptFee) } : {}),
        ...(attemptCnt ? { attemptCount: Number(attemptCnt) } : {}),
      };
      setPreview(await onPreview(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
      <h2 className="font-semibold mb-3">Invoice preview</h2>
      {error && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning mb-3">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Recovery fee (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={recoveryFee}
            onChange={(e) => setRecoveryFee(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Skip-trace fee (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={skipTraceFee}
            onChange={(e) => setSkipTraceFee(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Storage days</span>
          <input
            type="number"
            min="0"
            value={storageDays}
            onChange={(e) => setStorageDays(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Storage rate/day (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={storageRate}
            onChange={(e) => setStorageRate(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Attempt fee (USD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={attemptFee}
            onChange={(e) => setAttemptFee(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Billable attempts</span>
          <input
            type="number"
            min="0"
            value={attemptCnt}
            onChange={(e) => setAttemptCnt(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-4 px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        {busy ? 'Calculating…' : 'Preview invoice'}
      </button>

      {preview && (
        <div className="mt-4 border-t border-border-on-dark pt-3">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left py-1.5">Line</th>
                <th className="text-right py-1.5">Qty</th>
                <th className="text-right py-1.5">Unit</th>
                <th className="text-right py-1.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr
                  key={`${line.lineType}-${line.description}`}
                  className="border-t border-border-on-dark"
                >
                  <td className="py-1.5">{line.description}</td>
                  <td className="py-1.5 text-right text-text-secondary-on-dark">{line.quantity}</td>
                  <td className="py-1.5 text-right text-text-secondary-on-dark">
                    {formatCents(line.unitPriceCents)}
                  </td>
                  <td className="py-1.5 text-right">{formatCents(line.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-on-dark">
                <td className="py-1.5 font-semibold" colSpan={3}>
                  Subtotal
                </td>
                <td className="py-1.5 text-right font-semibold">
                  {formatCents(preview.subtotalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
