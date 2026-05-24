'use client';
import { fetchMyBids, getBidderToken } from '@/lib/api/marketplace-client';
import type { AuctionBidDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type JSX, useEffect, useState } from 'react';
import { formatCents, formatDateTime } from '../../marketplace-ui';

export function MyBidsClient({ slug }: { slug: string }): JSX.Element {
  const [bids, setBids] = useState<AuctionBidDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean>(true);
  const base = `/marketplace/${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (!getBidderToken(slug)) {
      setAuthed(false);
      return;
    }
    fetchMyBids(slug)
      .then(setBids)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load bids.'));
  }, [slug]);

  if (!authed) {
    return (
      <section className="max-w-sm mx-auto text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-4">My bids</h1>
        <p className="text-sm">
          <Link href={`${base}/login`} className="text-accent-orange font-semibold">
            Sign in
          </Link>{' '}
          to see your bids.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
        {error}
      </p>
    );
  }
  if (bids === null) return <p className="text-text-secondary-on-dark">Loading…</p>;

  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight mb-6">My bids</h1>
      {bids.length === 0 ? (
        <p className="text-text-secondary-on-dark">You haven't placed any bids yet.</p>
      ) : (
        <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Listing</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Placed</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id} className="border-t border-border-on-dark">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`${base}/listing/${b.listingId}`}
                      className="text-accent-orange hover:underline"
                    >
                      View listing
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCents(b.bidAmountCents)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {formatDateTime(b.placedAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.isWinning ? (
                      <span className="text-[11px] font-semibold uppercase text-status-success-on-dark">
                        Winning
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-secondary-on-dark">Placed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
