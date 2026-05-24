/**
 * /auction/[id] — operator listing detail: vehicle + bid history + the
 * publish / withdraw / end / award actions.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { AuctionListingDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { AuctionDetailClient } from './detail-client';

export const metadata = { title: 'Auction listing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<AuctionListingDetailDto>(`/auction/listings/${id}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Auction listing</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to this listing.
        </p>
        <p className="mt-3">
          <Link href="/auction" className="text-accent-orange">
            ← Back to auctions
          </Link>
        </p>
      </section>
    );
  }
  if (result.error?.status === 404 || !result.data) {
    notFound();
  }

  return <AuctionDetailClient detail={result.data} />;
}
