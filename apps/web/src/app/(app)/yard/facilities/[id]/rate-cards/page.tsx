/**
 * /yard/facilities/[id]/rate-cards — storage rate cards per vehicle class
 * with an effective-date timeline (Yard Management, Session 54).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { StorageRateCardDto, YardFacilityDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { RateCardsClient } from './rate-cards-client';

export const metadata = { title: 'Storage Rate Cards — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function RateCardsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const facility = await tryFetch(() =>
    apiServer<YardFacilityDto>(`/yard/facilities/${id}`, { accessToken: token ?? null }),
  );
  if (facility.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Storage Rate Cards</h1>
        <p className="text-text-secondary-on-dark">No access to yard management.</p>
        <Link href="/yard/facilities" className="mt-3 block text-accent-orange">
          ← Facilities
        </Link>
      </section>
    );
  }
  if (!facility.data) notFound();

  const cards = await tryFetch(() =>
    apiServer<StorageRateCardDto[]>(`/yard/facilities/${id}/rate-cards`, {
      accessToken: token ?? null,
    }),
  );
  return <RateCardsClient facility={facility.data} initial={cards.data ?? []} />;
}
