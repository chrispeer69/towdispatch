/**
 * /tier-offers/[id] — detail / sent-tracker / reconciliation.
 *
 * Server component fetches the offer + recipient roster + reconciliation
 * (when the offer status warrants it) in parallel, then hands off to the
 * client tracker for live polling and inline actions.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { ReconciliationReport } from '@/lib/api/tier-offers-client';
import { getSessionToken } from '@/lib/auth/session';
import type { TierOfferDto, TierOfferRecipientDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { OfferDetailClient } from './detail-client';

export const metadata = { title: 'Tier offer — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface Detail {
  offer: TierOfferDto;
  recipients: TierOfferRecipientDto[];
}

export default async function TierOfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const detailR = await tryFetch(() =>
    apiServer<Detail>(`/tier-offers/${id}`, { accessToken: token ?? null }),
  );
  if (detailR.error?.status === 404) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Offer not found</h1>
        <p className="text-text-secondary-on-dark">
          The offer may have been deleted, or you do not have access to it.
        </p>
        <p className="mt-3">
          <Link href="/tier-offers" className="text-accent-orange">
            ← Back to offers
          </Link>
        </p>
      </section>
    );
  }
  if (detailR.error) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Could not load offer</h1>
        <p className="text-text-secondary-on-dark">{detailR.error.message}</p>
      </section>
    );
  }
  const { offer, recipients } = detailR.data ?? { offer: null, recipients: [] };
  if (!offer) {
    return <section className="p-8">Offer not found.</section>;
  }
  let reconciliation: ReconciliationReport | null = null;
  if (
    offer.status === 'sent' ||
    offer.status === 'event_active' ||
    offer.status === 'event_concluded'
  ) {
    const rR = await tryFetch(() =>
      apiServer<ReconciliationReport>(`/tier-offers/${id}/reconciliation`, {
        accessToken: token ?? null,
      }),
    );
    reconciliation = rR.data ?? null;
  }
  return (
    <OfferDetailClient
      initialOffer={offer}
      initialRecipients={recipients}
      initialReconciliation={reconciliation}
    />
  );
}
