import type { JSX } from 'react';
import { LoginClient } from './login-client';

export const metadata = { title: 'Sign in — Vehicle Auctions' };
export const dynamic = 'force-dynamic';

export default async function MarketplaceLoginPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  return <LoginClient slug={tenantSlug} />;
}
