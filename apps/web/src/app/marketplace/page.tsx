/**
 * /marketplace — PUBLIC app directory (Session 46). Unauthenticated, server-
 * rendered. Lists `listed` apps from the marketplace-api, filterable by
 * category. When MARKETPLACE_API_ENABLED is off the API returns 503 and we
 * render an "unavailable" state rather than erroring.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { DirectoryPage, MarketplaceAppCategory } from '@ustowdispatch/shared';
import { marketplaceAppCategoryValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'App Marketplace — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  category?: string;
  q?: string;
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const category =
    params.category && (marketplaceAppCategoryValues as readonly string[]).includes(params.category)
      ? (params.category as MarketplaceAppCategory)
      : null;

  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  if (params.q) qs.set('q', params.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const result = await tryFetch(() =>
    apiServer<DirectoryPage>(`/marketplace/apps${suffix}`, { accessToken: null }),
  );

  const page = result.data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-4xl font-extrabold uppercase tracking-tight">
          App Marketplace
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Third-party apps that connect to your US Tow DISPATCH account.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by category">
        <CategoryLink label="All" href="/marketplace" active={category === null} />
        {marketplaceAppCategoryValues.map((c) => (
          <CategoryLink
            key={c}
            label={c}
            href={`/marketplace?category=${c}`}
            active={category === c}
          />
        ))}
      </nav>

      {!page ? (
        <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8 text-center">
          <p className="text-text-secondary-on-dark">
            The marketplace is not available right now. Please check back soon.
          </p>
        </section>
      ) : page.apps.length === 0 ? (
        <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8 text-center">
          <p className="text-text-secondary-on-dark">No apps match this filter yet.</p>
        </section>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {page.apps.map((app) => (
            <li key={app.slug}>
              <Link
                href={`/marketplace/${app.slug}`}
                className="block h-full rounded-[14px] border border-divider bg-bg-surface p-5 transition-colors hover:border-accent-orange"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-text-primary-on-dark">{app.name}</h2>
                  <span className="rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-text-secondary-on-dark">
                    {app.category}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-text-secondary-on-dark">
                  {app.description || 'No description provided.'}
                </p>
                <p className="mt-3 text-xs text-text-secondary-on-dark">by {app.developerName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function CategoryLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}): JSX.Element {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        active
          ? 'bg-accent-orange text-black'
          : 'bg-bg-surface-elevated text-text-secondary-on-dark hover:text-text-primary-on-dark'
      }`}
    >
      {label}
    </Link>
  );
}
