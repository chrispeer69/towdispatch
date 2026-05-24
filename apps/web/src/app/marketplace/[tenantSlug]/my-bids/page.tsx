import type { JSX } from 'react';
import { MyBidsClient } from './my-bids-client';

export const metadata = { title: 'My bids — Vehicle Auctions' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceMyBidsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  return <MyBidsClient slug={tenantSlug} />;
}
