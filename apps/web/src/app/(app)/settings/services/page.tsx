/**
 * /settings/services — the Service Catalog + Master Rate Sheet admin surface.
 *
 * Build 1 (#23): Catalog view — structural CRUD on services.
 * Build 2 (this build): Rate Sheet view — inline-editable price grid keyed
 * off the catalog. View toggle lives in services-view-toggle.tsx and
 * persists choice via ?view=rate_sheet in the URL.
 *
 * Both initial datasets (catalog + rates) are fetched server-side here so
 * the first paint has data; the client island handles every subsequent
 * mutation.
 */
import { fetchServiceCatalog, fetchServiceRates } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type {
  ServiceCatalogEntryDto,
  ServiceCategory,
  ServiceRateDto,
} from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { RateSheetClient } from './rate-sheet-client';
import { ServiceCatalogClient } from './service-catalog-client';
import { ServicesViewToggle } from './services-view-toggle';

export const metadata = { title: 'Services & Pricing — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const TAB = findSettingsTab('services');

interface SearchParams {
  category?: ServiceCategory;
  active?: string;
  q?: string;
  view?: string;
}

export default async function ServicesPricingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const token = await getSessionToken();

  let catalog: ServiceCatalogEntryDto[] = [];
  let rates: ServiceRateDto[] = [];
  let loadError: string | null = null;
  try {
    [catalog, rates] = await Promise.all([
      fetchServiceCatalog(
        {
          category: params.category,
          active: params.active,
          q: params.q,
        },
        token,
      ),
      fetchServiceRates(token),
    ]);
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
          The service catalog defines what your shop bills for. The rate sheet sets the price.
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

      <ServicesViewToggle
        catalog={
          <ServiceCatalogClient
            initial={catalog}
            initialCategory={params.category ?? null}
            initialActive={
              params.active === 'true' ? true : params.active === 'false' ? false : null
            }
            initialQ={params.q ?? ''}
          />
        }
        rateSheet={<RateSheetClient catalog={catalog} initialRates={rates} />}
      />
    </div>
  );
}
