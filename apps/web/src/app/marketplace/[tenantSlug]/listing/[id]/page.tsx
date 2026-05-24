import type { JSX } from 'react';
import { ListingClient } from './listing-client';

export const metadata = { title: 'Auction listing' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceListingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug, id } = await params;
  return <ListingClient slug={tenantSlug} listingId={id} />;
}
