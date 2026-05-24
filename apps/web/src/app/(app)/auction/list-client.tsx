'use client';
import type { AuctionListingDto, AuctionListingStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatCents,
  formatDateTime,
  vehicleLabel,
} from './auction-ui-helpers';

interface Props {
  listings: AuctionListingDto[];
  status: AuctionListingStatus | null;
}

const FILTERS: { label: string; status: AuctionListingStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Draft', status: 'draft' },
  { label: 'Live', status: 'live' },
  { label: 'Ended — review', status: 'ended' },
  { label: 'Sold', status: 'sold' },
  { label: 'Withdrawn', status: 'withdrawn' },
];

export function AuctionListClient({ listings, status }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(next: AuctionListingStatus | null): void {
    startTransition(() => {
      router.push(next ? `/auction?status=${next}` : '/auction');
    });
  }

  const counts = listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Auctions</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            List lien-cleared vehicles for competitive bidding, track bids, and award winners.
          </p>
        </div>
        <Link
          href="/auction/new"
          className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold whitespace-nowrap"
        >
          New listing
        </Link>
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {(['live', 'draft', 'ended', 'sold', 'withdrawn'] as AuctionListingStatus[]).map((s) => (
          <div
            key={s}
            className="rounded-md border border-border-on-dark bg-bg-surface-elevated px-3 py-2"
          >
            <div className="text-[11px] uppercase tracking-wide text-text-secondary-on-dark">
              {STATUS_LABEL[s]}
            </div>
            <div className="text-xl font-bold tabular-nums">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Status filter pills */}
      <nav className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filter listings">
        {FILTERS.map((f) => {
          const active = (status ?? null) === f.status;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => navigate(f.status)}
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
              <th className="text-left px-4 py-2.5">Vehicle</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Starting</th>
              <th className="text-right px-4 py-2.5">Reserve</th>
              <th className="text-left px-4 py-2.5">Ends</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No listings in this view yet.
                </td>
              </tr>
            )}
            {listings.map((l) => (
              <tr key={l.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/auction/${l.id}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    {vehicleLabel(l)}
                  </Link>
                  <div className="text-[11px] text-text-secondary-on-dark">{l.vin ?? '—'}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[l.status]}`}
                  >
                    {STATUS_LABEL[l.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCents(l.startingBidCents)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCents(l.reservePriceCents)}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {formatDateTime(l.listEndsAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/auction/${l.id}`} className="text-accent-orange text-xs">
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
