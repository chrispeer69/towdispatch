/**
 * /tier-offers — list page for the operator-side Tier Offer Composer.
 *
 * Defaults to the "active and recent" filter (sent + event_active +
 * event_concluded), which is what the operator usually wants on first
 * visit. Status filter pills let them narrow further. Drafts are
 * surfaced under "Drafts" so they aren't lost in the noise.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { TierOfferDto, TierOfferStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { TierOfferListClient } from './list-client';

export const metadata = { title: 'Tier Offers — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: TierOfferStatus;
}

const KNOWN_STATUSES: TierOfferStatus[] = [
  'draft',
  'sent',
  'event_active',
  'event_concluded',
  'cancelled',
];

export default async function TierOffersListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const statusFilter =
    params.status && KNOWN_STATUSES.includes(params.status) ? params.status : null;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<TierOfferDto[]>(`/tier-offers${statusFilter ? `?status=${statusFilter}` : ''}`, {
      accessToken: token ?? null,
    }),
  );
  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Tier Offers</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the Tier Offer Composer. Ask an owner or admin to extend
          your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }
  const offers = result.data ?? [];
  return <TierOfferListClient offers={offers} status={statusFilter} />;
}
