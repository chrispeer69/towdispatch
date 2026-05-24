/**
 * /yard/facilities/[id]/map — the visual stall grid for a facility.
 * Server-fetches the facility + its stalls; the client renders the grid and
 * handles assignment, photos, and drag-drop layout.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { YardFacilityDto, YardStallDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { StallMapClient } from './map-client';

export const metadata = { title: 'Stall Map — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function StallMapPage({
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
        <h1 className="mb-2 text-2xl font-bold">Stall Map</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to yard management.
        </p>
        <p className="mt-3">
          <Link href="/yard/facilities" className="text-accent-orange">
            ← Facilities
          </Link>
        </p>
      </section>
    );
  }
  if (!facility.data) notFound();

  const stalls = await tryFetch(() =>
    apiServer<YardStallDto[]>(`/yard/facilities/${id}/stalls`, { accessToken: token ?? null }),
  );

  return <StallMapClient facility={facility.data} initialStalls={stalls.data ?? []} />;
}
