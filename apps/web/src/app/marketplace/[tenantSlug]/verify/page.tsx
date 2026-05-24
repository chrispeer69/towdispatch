import type { JSX } from 'react';
import { VerifyClient } from './verify-client';

export const metadata = { title: 'Verify email — Vehicle Auctions' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceVerifyPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  return <VerifyClient slug={tenantSlug} />;
}
