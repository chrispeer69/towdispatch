/**
 * /settings/services — the Service Catalog admin surface (build 1 of 6 in
 * the Admin Settings rollout). Replaces the "Coming soon" placeholder.
 *
 * Pricing is intentionally OUT of scope here — that lands with the Master
 * Rate Sheet at /settings/services in build 2 (the rate sheet becomes a
 * sub-route, this page stays as the catalog index).
 */
import { fetchServiceCatalog } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type { ServiceCatalogEntryDto, ServiceCategory } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { ServiceCatalogClient } from './service-catalog-client';

export const metadata = { title: 'Services & Pricing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const TAB = findSettingsTab('services');

interface SearchParams {
  category?: ServiceCategory;
  active?: string;
  q?: string;
}

export default async function ServicesPricingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const token = await getSessionToken();

  let initial: ServiceCatalogEntryDto[] = [];
  let loadError: string | null = null;
  try {
    initial = await fetchServiceCatalog(
      {
        category: params.category,
        active: params.active,
        q: params.q,
      },
      token,
    );
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load services';
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          {TAB.label}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          The service catalog defines what your shop bills for. Prices and the rate sheet ship next.
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {loadError}
        </div>
      ) : null}

      <ServiceCatalogClient
        initial={initial}
        initialCategory={params.category ?? null}
        initialActive={params.active === 'true' ? true : params.active === 'false' ? false : null}
        initialQ={params.q ?? ''}
      />
    </div>
  );
}
