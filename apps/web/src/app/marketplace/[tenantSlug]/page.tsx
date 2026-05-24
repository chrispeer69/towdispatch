import type { JSX } from 'react';
import { BrowseClient } from './browse-client';

export const metadata = { title: 'Vehicle Auctions' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceBrowsePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  return <BrowseClient slug={tenantSlug} />;
}
