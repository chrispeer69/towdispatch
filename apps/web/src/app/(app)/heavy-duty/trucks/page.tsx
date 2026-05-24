/**
 * /heavy-duty/trucks — per-truck HD capability editor. Server-fetches the
 * tenant trucks (picker) + the current capability rows.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { fetchTrucks } from '@/lib/api/fleet';
import { getSessionToken } from '@/lib/auth/session';
import type { HdTruckCapabilityDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { TruckCapabilitiesClient } from './trucks-client';

export const metadata = { title: 'HD Truck Capabilities — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function HdTrucksPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const caps = await tryFetch(() =>
    apiServer<HdTruckCapabilityDto[]>('/heavy-duty/trucks/capabilities', {
      accessToken: token ?? null,
    }),
  );

  if (caps.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">HD Truck Capabilities</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to heavy-duty truck capabilities.
        </p>
        <p className="mt-3">
          <Link href="/heavy-duty" className="text-accent-orange">
            ← Back to heavy-duty
          </Link>
        </p>
      </section>
    );
  }

  const trucks = await tryFetch(() => fetchTrucks({ perPage: '200' }, token));
  const truckOptions = (trucks.data?.data ?? []).map((t) => ({
    id: t.id,
    unitNumber: t.unitNumber,
  }));

  return <TruckCapabilitiesClient trucks={truckOptions} capabilities={caps.data ?? []} />;
}
