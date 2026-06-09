/**
 * /auction — operator listing roster for the Auction & Remarketing
 * Marketplace. Server-fetches the listings and hands them to the client.
 * AUDITOR is read-only; MANAGER / ACCOUNTING / DRIVER get a 403 explainer.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { AuctionListingDto, AuctionListingStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { AuctionListClient } from './list-client';

export const metadata = { title: 'Auctions — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const KNOWN_STATUSES: AuctionListingStatus[] = ['draft', 'live', 'ended', 'sold', 'withdrawn'];

interface SearchParams {
  status?: AuctionListingStatus;
}

export default async function AuctionListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const statusFilter =
    params.status && KNOWN_STATUSES.includes(params.status) ? params.status : null;
  const token = await getSessionToken();
  const suffix = statusFilter ? `?status=${statusFilter}` : '';

  const result = await tryFetch(() =>
    apiServer<AuctionListingDto[]>(`/auction/listings${suffix}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Auctions</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the auction marketplace. Ask an owner or admin to extend
          your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  return <AuctionListClient listings={result.data ?? []} status={statusFilter} />;
}
