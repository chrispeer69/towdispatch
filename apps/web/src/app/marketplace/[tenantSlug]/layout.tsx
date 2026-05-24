/**
 * Public marketplace shell (Session 33). Deliberately NOT inside (app)/ —
 * there is no staff session here. A bidder authenticates with a separate
 * JWT held client-side. Branding uses fallback defaults until S32 lands.
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { MARKETPLACE_BRAND } from '../marketplace-ui';

export default async function MarketplaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}): Promise<JSX.Element> {
  const { tenantSlug } = await params;
  const base = `/marketplace/${encodeURIComponent(tenantSlug)}`;
  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <header className="border-b border-border-on-dark bg-bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href={base} className="text-lg font-extrabold tracking-tight">
            {MARKETPLACE_BRAND.name}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href={base} className="hover:text-accent-orange">
              Browse
            </Link>
            <Link href={`${base}/my-bids`} className="hover:text-accent-orange">
              My bids
            </Link>
            <Link
              href={`${base}/login`}
              className="px-3 py-1.5 rounded-md bg-accent-orange text-white font-semibold"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
