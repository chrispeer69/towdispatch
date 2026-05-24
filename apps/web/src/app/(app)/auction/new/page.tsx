/**
 * /auction/new — create a listing. Server-fetches the lien-cleared vehicles
 * eligible to be listed (the operator picks one here, so this page never
 * touches the impound module's UI). Manual entry is also supported.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { AuctionEligibleVehicleDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { AuctionCreateClient } from './create-client';

export const metadata = { title: 'New auction listing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function NewAuctionPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<AuctionEligibleVehicleDto[]>('/auction/eligible-vehicles', {
      accessToken: token ?? null,
    }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">New auction listing</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to create auction listings.
        </p>
        <p className="mt-3">
          <Link href="/auction" className="text-accent-orange">
            ← Back to auctions
          </Link>
        </p>
      </section>
    );
  }

  return <AuctionCreateClient eligible={result.data ?? []} />;
}
