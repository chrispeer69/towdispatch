'use client';
import {
  clientAwardListing,
  clientEndListing,
  clientPublishListing,
  clientWithdrawListing,
} from '@/lib/api/auction-client';
import type { AuctionListingDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import {
  CONDITION_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  formatCents,
  formatDateTime,
  vehicleLabel,
} from '../auction-ui-helpers';

interface Props {
  detail: AuctionListingDetailDto;
}

export function AuctionDetailClient({ detail }: Props): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState('');

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

  async function publish(): Promise<void> {
    if (!endsAt) {
      setError('Choose an end date/time to publish.');
      return;
    }
    await run(() =>
      clientPublishListing(detail.id, { listEndsAt: new Date(endsAt).toISOString() }),
    );
  }

  const canPublish = detail.status === 'draft';
  const canWithdraw = detail.status === 'draft' || detail.status === 'live';
  const canEnd = detail.status === 'live';
  const canAward = detail.status === 'ended';

  return (
    <section className="max-w-4xl">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <Link href="/auction" className="text-accent-orange text-sm">
            ← Back to auctions
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1">{vehicleLabel(detail)}</h1>
          <div className="mt-2 flex items-center gap-3">
            <span
              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[detail.status]}`}
            >
              {STATUS_LABEL[detail.status]}
            </span>
            {detail.reserveMet && (
              <span className="text-[11px] font-semibold uppercase text-status-success-on-dark">
                Reserve met
              </span>
            )}
          </div>
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

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Field label="VIN" value={detail.vin ?? '—'} />
        <Field
          label="Condition"
          value={detail.conditionGrade ? CONDITION_LABEL[detail.conditionGrade] : '—'}
        />
        <Field
          label="Mileage"
          value={detail.mileage !== null ? detail.mileage.toLocaleString() : '—'}
        />
        <Field label="Starting bid" value={formatCents(detail.startingBidCents)} />
        <Field label="Reserve" value={formatCents(detail.reservePriceCents)} />
        <Field label="Current high bid" value={formatCents(detail.currentHighBidCents)} />
        <Field label="Starts" value={formatDateTime(detail.listStartsAt)} />
        <Field label="Ends" value={formatDateTime(detail.listEndsAt)} />
      </div>

      {/* Actions */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-4 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary-on-dark mb-3">
          Actions
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          {canPublish && (
            <>
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1">
                  Bidding ends
                </span>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={publish}
                className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
              >
                Publish
              </button>
            </>
          )}
          {canEnd && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => clientEndListing(detail.id))}
              className="px-4 py-2 rounded-md bg-status-warning/20 text-status-warning border border-status-warning/40 font-semibold disabled:opacity-50"
            >
              End bidding now
            </button>
          )}
          {canWithdraw && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => clientWithdrawListing(detail.id))}
              className="px-4 py-2 rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 font-semibold disabled:opacity-50"
            >
              Withdraw
            </button>
          )}
          {!canPublish && !canEnd && !canWithdraw && !canAward && (
            <p className="text-sm text-text-secondary-on-dark">
              No actions available in this state.
            </p>
          )}
        </div>
      </div>

      {/* Photos */}
      {detail.photos.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary-on-dark mb-2">
            Photos ({detail.photos.length})
          </h2>
          <ul className="text-xs text-text-secondary-on-dark space-y-1">
            {detail.photos.map((p) => (
              <li key={p.id} className="font-mono break-all">
                {p.photoKey}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bid history */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary-on-dark mb-2">
          Bids ({detail.bidCount})
        </h2>
        <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Bidder</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Placed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.bids.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-secondary-on-dark">
                    No bids yet.
                  </td>
                </tr>
              )}
              {detail.bids.map((b) => (
                <tr key={b.id} className="border-t border-border-on-dark">
                  <td className="px-4 py-2.5">
                    {b.bidderName}
                    {b.bidderBusinessName ? (
                      <span className="text-[11px] text-text-secondary-on-dark">
                        {' '}
                        · {b.bidderBusinessName}
                      </span>
                    ) : null}
                    {b.isWinning && (
                      <span className="ml-2 text-[10px] font-semibold uppercase text-status-success-on-dark">
                        Winner
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCents(b.bidAmountCents)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {formatDateTime(b.placedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canAward && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => clientAwardListing(detail.id, { bidId: b.id }))}
                        className="text-accent-orange text-xs font-semibold disabled:opacity-50"
                      >
                        Award
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canAward && (
          <p className="mt-2 text-xs text-text-secondary-on-dark">
            This listing ended without an automatic sale (no reserve, or reserve not met). Award a
            bid manually to mark it sold.
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-text-secondary-on-dark">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
