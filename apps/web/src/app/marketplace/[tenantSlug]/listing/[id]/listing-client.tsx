'use client';
import { browseListing, getBidder, placeBid } from '@/lib/api/marketplace-client';
import type { AuctionBidderDto, PublicAuctionListingDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { formatCents, formatDateTime, listingTitle } from '../../../marketplace-ui';

export function ListingClient({
  slug,
  listingId,
}: {
  slug: string;
  listingId: string;
}): JSX.Element {
  const [listing, setListing] = useState<PublicAuctionListingDto | null>(null);
  const [bidder, setBidder] = useState<AuctionBidderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  function load(): void {
    browseListing(slug, listingId)
      .then(setListing)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load listing.'));
  }

  useEffect(() => {
    load();
    setBidder(getBidder(slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, listingId]);

  async function submitBid(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cents = Math.round(Number.parseFloat(amount || '0') * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid bid amount.');
      return;
    }
    setBusy(true);
    try {
      await placeBid(slug, listingId, cents);
      setNotice('Bid placed!');
      setAmount('');
      load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Bid failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !listing) {
    return (
      <p className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
        {error}
      </p>
    );
  }
  if (!listing) return <p className="text-text-secondary-on-dark">Loading…</p>;

  const base = `/marketplace/${encodeURIComponent(slug)}`;
  const minBid = (listing.currentHighBidCents ?? listing.startingBidCents) / 100;
  const isLive = listing.status === 'live';

  return (
    <section className="max-w-2xl">
      <Link href={base} className="text-accent-orange text-sm">
        ← Back to listings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight mt-2">{listingTitle(listing)}</h1>
      <p className="text-text-secondary-on-dark text-sm">{listing.vin ?? ''}</p>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Field
          label="Current bid"
          value={formatCents(listing.currentHighBidCents ?? listing.startingBidCents)}
        />
        <Field label="Starting bid" value={formatCents(listing.startingBidCents)} />
        <Field label="Bids" value={String(listing.bidCount)} />
        <Field label="Condition" value={listing.conditionGrade ?? '—'} />
        <Field
          label="Mileage"
          value={listing.mileage !== null ? listing.mileage.toLocaleString() : '—'}
        />
        <Field label="Ends" value={formatDateTime(listing.listEndsAt)} />
      </dl>

      {listing.reserveMet && (
        <p className="mt-3 text-sm text-status-success-on-dark font-semibold">Reserve met</p>
      )}

      {notice && (
        <p className="mt-4 rounded-md border border-status-success-on-dark/40 bg-status-success-on-dark/10 px-4 py-3 text-sm text-status-success-on-dark">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          {error}
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border-on-dark bg-bg-surface-elevated p-4">
        {!isLive ? (
          <p className="text-sm text-text-secondary-on-dark">Bidding is closed for this listing.</p>
        ) : bidder ? (
          <form onSubmit={submitBid} className="flex items-end gap-3">
            <label className="flex-1">
              <span className="block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1">
                Your bid (USD) — must beat{' '}
                {formatCents(listing.currentHighBidCents ?? listing.startingBidCents)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(minBid + 50)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
            >
              {busy ? 'Placing…' : 'Place bid'}
            </button>
          </form>
        ) : (
          <p className="text-sm">
            <Link href={`${base}/login`} className="text-accent-orange font-semibold">
              Sign in
            </Link>{' '}
            to place a bid.
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-text-secondary-on-dark">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
