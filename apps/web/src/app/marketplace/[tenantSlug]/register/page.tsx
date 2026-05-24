import type { JSX } from 'react';
import { RegisterClient } from './register-client';

export const metadata = { title: 'Register — Vehicle Auctions' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceRegisterPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  return <RegisterClient slug={tenantSlug} />;
}
