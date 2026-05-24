'use client';
import { browseListings } from '@/lib/api/marketplace-client';
import type { PublicAuctionListingDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type JSX, useEffect, useState } from 'react';
import { formatCents, formatDateTime, listingTitle } from '../marketplace-ui';

export function BrowseClient({ slug }: { slug: string }): JSX.Element {
  const [listings, setListings] = useState<PublicAuctionListingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    browseListings(slug)
      .then(setListings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load listings.'));
  }, [slug]);

  if (error) {
    return (
      <p className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
        {error}
      </p>
    );
  }
  if (listings === null) {
    return <p className="text-text-secondary-on-dark">Loading listings…</p>;
  }

  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight mb-1">Live auctions</h1>
      <p className="text-text-secondary-on-dark text-sm mb-6">
        {listings.length} vehicle{listings.length === 1 ? '' : 's'} open for bidding.
      </p>

      {listings.length === 0 ? (
        <p className="text-text-secondary-on-dark">No live listings right now. Check back soon.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-4">
          {listings.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-border-on-dark bg-bg-surface-elevated p-4"
            >
              <Link
                href={`/marketplace/${encodeURIComponent(slug)}/listing/${l.id}`}
                className="block"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-semibold hover:text-accent-orange">{listingTitle(l)}</h2>
                  <span className="text-xs text-text-secondary-on-dark">{l.bidCount} bids</span>
                </div>
                <div className="mt-2 text-sm">
                  <span className="text-text-secondary-on-dark">Current bid: </span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(l.currentHighBidCents ?? l.startingBidCents)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-text-secondary-on-dark">
                  Ends {formatDateTime(l.listEndsAt)}
                  {l.reserveMet && (
                    <span className="ml-2 text-status-success-on-dark font-semibold">
                      Reserve met
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
