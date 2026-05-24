'use client';
import { useUser } from '@/components/app-shell/session-provider';
import {
  clientAddFee,
  clientAddHold,
  clientCloseRecord,
  clientReleaseHold,
  clientReleaseRecord,
} from '@/lib/api/impound-client';
import type {
  ImpoundFormKind,
  ImpoundHoldType,
  ImpoundManualFeeType,
  ImpoundRecordDetailDto,
  ImpoundReleasePaymentMethod,
  ImpoundReleaseToType,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import {
  HOLD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  formatCents,
  formatDate,
  vehicleLabel,
} from '../impound-ui-helpers';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';
const cardCls = 'bg-bg-surface-elevated rounded-md border border-border-on-dark p-5';

const HOLD_TYPES: ImpoundHoldType[] = ['police', 'abandoned', 'accident', 'owner_request'];
const FEE_TYPES: ImpoundManualFeeType[] = [
  'intake',
  'administrative',
  'lien_processing',
  'gate',
  'other',
];
const RELEASE_TO_TYPES: ImpoundReleaseToType[] = [
  'owner',
  'agent',
  'insurance',
  'lienholder',
  'salvage',
  'other',
];
const PAYMENT_METHODS: ImpoundReleasePaymentMethod[] = [
  'cash',
  'card',
  'check',
  'ach',
  'waived',
  'other',
];
const FORM_KINDS: { kind: ImpoundFormKind; label: string }[] = [
  { kind: 'lien_notice', label: 'Lien notice' },
  { kind: 'release_authorization', label: 'Release authorization' },
  { kind: 'abandoned_vehicle_notice', label: 'Abandoned-vehicle notice' },
  { kind: 'storage_invoice', label: 'Storage invoice' },
];

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function ImpoundDetailClient({ detail }: { detail: ImpoundRecordDetailDto }): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const { record, yard, holds, fees, release, feeTotalCents, activeHoldCount } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  // Hold form
  const [holdType, setHoldType] = useState<ImpoundHoldType>('police');
  const [authorityName, setAuthorityName] = useState('');
  const [authorityRef, setAuthorityRef] = useState('');
  const [holdReason, setHoldReason] = useState('');

  // Fee form
  const [feeType, setFeeType] = useState<ImpoundManualFeeType>('administrative');
  const [feeAmount, setFeeAmount] = useState('');
  const [feeDesc, setFeeDesc] = useState('');

  // Release form
  const [releasedToName, setReleasedToName] = useState('');
  const [releasedToType, setReleasedToType] = useState<ImpoundReleaseToType>('owner');
  const [idVerified, setIdVerified] = useState(false);
  const [ownershipVerified, setOwnershipVerified] = useState(false);
  const [authDocRef, setAuthDocRef] = useState('');
  const [paymentDollars, setPaymentDollars] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ImpoundReleasePaymentMethod>('cash');

  const isTerminal =
    record.status === 'released' || record.status === 'transferred' || record.status === 'disposed';
  const releaseBlocked = activeHoldCount > 0 || !idVerified || !ownershipVerified;

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function fetchFormStub(kind: ImpoundFormKind): Promise<void> {
    setError(null);
    setFormMessage(null);
    try {
      const res = await fetch(`/api/impound/records/${record.id}/forms/${kind}`);
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Failed to generate form');
      setFormMessage(body.message ?? 'Form generated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Form generation failed.');
    }
  }

  return (
    <section className="max-w-5xl">
      <header className="mb-6">
        <Link href="/impound" className="text-accent-orange text-sm">
          ← Back to impound
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-3xl font-bold tracking-tight">{vehicleLabel(record)}</h1>
          <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[record.status]}`}
          >
            {STATUS_LABEL[record.status]}
          </span>
          {record.lienEligible && (
            <span className="text-[11px] font-semibold uppercase text-status-warning">
              Lien eligible
            </span>
          )}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
        >
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <Stat label="Yard" value={`${yard.name} (${yard.code})`} />
        <Stat label="Arrived" value={formatDate(record.arrivedAt)} />
        <Stat label="Daily fee" value={formatCents(record.dailyFeeCents)} />
        <Stat label="Accrued fees" value={formatCents(record.accruedFeeCents)} />
        <Stat label="Ledger total" value={formatCents(feeTotalCents)} />
        <Stat label="Active holds" value={activeHoldCount > 0 ? `${activeHoldCount}` : 'None'} />
      </div>

      {/* Holds */}
      <div className={`${cardCls} mb-4`}>
        <h2 className="text-lg font-semibold mb-3">Holds</h2>
        {holds.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No holds placed.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {holds.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 border border-border-on-dark rounded-md px-3 py-2"
              >
                <div>
                  <span className="font-semibold text-sm">{HOLD_LABEL[h.holdType]}</span>
                  {h.authorityName && (
                    <span className="text-xs text-text-secondary-on-dark ml-2">
                      {h.authorityName}
                      {h.authorityReference ? ` · ${h.authorityReference}` : ''}
                    </span>
                  )}
                  <div className="text-[11px] text-text-secondary-on-dark">
                    Placed {formatDate(h.placedAt)}
                    {h.releasedAt ? ` · released ${formatDate(h.releasedAt)}` : ''}
                  </div>
                </div>
                {h.releasedAt === null ? (
                  canWrite ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => clientReleaseHold(record.id, h.id))}
                      className="px-3 py-1.5 rounded-md border border-border-on-dark text-xs"
                    >
                      Release hold
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold uppercase text-accent-orange">
                      Active
                    </span>
                  )
                ) : (
                  <span className="text-[11px] text-text-secondary-on-dark uppercase">
                    Released
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && !isTerminal && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end border-t border-border-on-dark pt-4">
            <label>
              <span className={labelCls}>Type</span>
              <select
                className={inputCls}
                value={holdType}
                onChange={(e) => setHoldType(e.target.value as ImpoundHoldType)}
              >
                {HOLD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {HOLD_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Authority</span>
              <input
                className={inputCls}
                value={authorityName}
                onChange={(e) => setAuthorityName(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>Reference</span>
              <input
                className={inputCls}
                value={authorityRef}
                onChange={(e) => setAuthorityRef(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await clientAddHold(record.id, {
                    holdType,
                    ...(authorityName.trim() ? { authorityName: authorityName.trim() } : {}),
                    ...(authorityRef.trim() ? { authorityReference: authorityRef.trim() } : {}),
                    ...(holdReason.trim() ? { reason: holdReason.trim() } : {}),
                  });
                  setAuthorityName('');
                  setAuthorityRef('');
                  setHoldReason('');
                })
              }
              className="px-3 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
            >
              Add hold
            </button>
          </div>
        )}
      </div>

      {/* Fees */}
      <div className={`${cardCls} mb-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Fee ledger</h2>
          <span className="text-sm font-semibold tabular-nums">{formatCents(feeTotalCents)}</span>
        </div>
        {fees.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No fees recorded yet.</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <tbody>
              {fees.map((f) => (
                <tr key={f.id} className="border-t border-border-on-dark first:border-t-0">
                  <td className="py-1.5 capitalize">{f.feeType.replace('_', ' ')}</td>
                  <td className="py-1.5 text-text-secondary-on-dark text-xs">
                    {f.description ?? f.accruedForDate ?? ''}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatCents(f.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canWrite && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end border-t border-border-on-dark pt-4">
            <label>
              <span className={labelCls}>Fee type</span>
              <select
                className={inputCls}
                value={feeType}
                onChange={(e) => setFeeType(e.target.value as ImpoundManualFeeType)}
              >
                {FEE_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Amount (USD)</span>
              <input
                className={inputCls}
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              <span className={labelCls}>Description</span>
              <input
                className={inputCls}
                value={feeDesc}
                onChange={(e) => setFeeDesc(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const cents = Math.round(Number.parseFloat(feeAmount || '0') * 100);
                if (!Number.isFinite(cents) || cents < 0) {
                  setError('Fee amount must be a non-negative dollar value.');
                  return;
                }
                void run(async () => {
                  await clientAddFee(record.id, {
                    feeType,
                    amountCents: cents,
                    ...(feeDesc.trim() ? { description: feeDesc.trim() } : {}),
                  });
                  setFeeAmount('');
                  setFeeDesc('');
                });
              }}
              className="px-3 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
            >
              Add fee
            </button>
          </div>
        )}
      </div>

      {/* Release / close */}
      {release ? (
        <div className={`${cardCls} mb-4`}>
          <h2 className="text-lg font-semibold mb-3">Released</h2>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div>
              <span className={labelCls}>Released to</span>
              {release.releasedToName}{' '}
              <span className="text-text-secondary-on-dark">({release.releasedToType})</span>
            </div>
            <div>
              <span className={labelCls}>Released at</span>
              {formatDate(release.releasedAt)}
            </div>
            <div>
              <span className={labelCls}>Payment</span>
              {formatCents(release.paymentReceivedCents)}
              {release.paymentMethod ? ` · ${release.paymentMethod}` : ''}
            </div>
          </div>
        </div>
      ) : (
        canWrite &&
        !isTerminal && (
          <div className={`${cardCls} mb-4`}>
            <h2 className="text-lg font-semibold mb-1">Release workflow</h2>
            <p className="text-sm text-text-secondary-on-dark mb-4">
              All active holds must be released and both documents verified before the vehicle can
              leave the yard.
            </p>
            {activeHoldCount > 0 && (
              <div className="mb-3 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
                {activeHoldCount} active hold(s) block release.
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <label>
                <span className={labelCls}>Released to (name)</span>
                <input
                  className={inputCls}
                  value={releasedToName}
                  onChange={(e) => setReleasedToName(e.target.value)}
                />
              </label>
              <label>
                <span className={labelCls}>Recipient type</span>
                <select
                  className={inputCls}
                  value={releasedToType}
                  onChange={(e) => setReleasedToType(e.target.value as ImpoundReleaseToType)}
                >
                  {RELEASE_TO_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelCls}>Authorization doc ref</span>
                <input
                  className={inputCls}
                  value={authDocRef}
                  onChange={(e) => setAuthDocRef(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={labelCls}>Payment (USD)</span>
                  <input
                    className={inputCls}
                    value={paymentDollars}
                    onChange={(e) => setPaymentDollars(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  <span className={labelCls}>Method</span>
                  <select
                    className={inputCls}
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as ImpoundReleasePaymentMethod)
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m} className="capitalize">
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 mt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={idVerified}
                  onChange={(e) => setIdVerified(e.target.checked)}
                />
                Government ID verified
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ownershipVerified}
                  onChange={(e) => setOwnershipVerified(e.target.checked)}
                />
                Proof of ownership verified
              </label>
            </div>
            <button
              type="button"
              disabled={busy || releaseBlocked || !releasedToName.trim()}
              onClick={() => {
                const cents = Math.round(Number.parseFloat(paymentDollars || '0') * 100);
                void run(() =>
                  clientReleaseRecord(record.id, {
                    releasedToName: releasedToName.trim(),
                    releasedToType,
                    idVerified,
                    ownershipDocVerified: ownershipVerified,
                    paymentReceivedCents: Number.isFinite(cents) && cents > 0 ? cents : 0,
                    paymentMethod,
                    ...(authDocRef.trim() ? { authorizationDocRef: authDocRef.trim() } : {}),
                  }),
                );
              }}
              className="mt-4 px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
            >
              Release vehicle
            </button>
          </div>
        )
      )}

      {/* Forms + close */}
      <div className={`${cardCls} mb-4`}>
        <h2 className="text-lg font-semibold mb-3">State forms</h2>
        <p className="text-sm text-text-secondary-on-dark mb-3">
          Document rendering lands in Session 23; these generate a stub payload today.
        </p>
        <div className="flex flex-wrap gap-2">
          {FORM_KINDS.map((f) => (
            <button
              key={f.kind}
              type="button"
              onClick={() => fetchFormStub(f.kind)}
              className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm text-text-secondary-on-dark hover:text-text-primary-on-dark"
            >
              {f.label}
            </button>
          ))}
        </div>
        {formMessage && <p className="text-xs text-text-secondary-on-dark mt-3">{formMessage}</p>}
      </div>

      {canWrite && !isTerminal && !release && (
        <div className={cardCls}>
          <h2 className="text-lg font-semibold mb-3">Close without release</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => clientCloseRecord(record.id, { disposition: 'transferred' }))
              }
              className="px-3 py-2 rounded-md border border-border-on-dark text-sm"
            >
              Mark transferred
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => clientCloseRecord(record.id, { disposition: 'disposed' }))}
              className="px-3 py-2 rounded-md border border-border-on-dark text-sm"
            >
              Mark disposed
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-text-secondary-on-dark">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
