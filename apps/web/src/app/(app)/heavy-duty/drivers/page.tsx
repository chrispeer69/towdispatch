/**
 * /heavy-duty/drivers — per-driver HD certification list + upload. Server-
 * fetches the tenant drivers (picker).
 */
import { tryFetch } from '@/lib/api/client';
import { fetchDrivers } from '@/lib/api/fleet';
import { getSessionToken } from '@/lib/auth/session';
import Link from 'next/link';
import type { JSX } from 'react';
import { DriverCertsClient } from './drivers-client';

export const metadata = { title: 'HD Driver Certifications — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function HdDriversPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const drivers = await tryFetch(() => fetchDrivers({ perPage: '200' }, token));

  if (drivers.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">HD Driver Certifications</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to heavy-duty driver certifications.
        </p>
        <p className="mt-3">
          <Link href="/heavy-duty" className="text-accent-orange">
            ← Back to heavy-duty
          </Link>
        </p>
      </section>
    );
  }

  const options = (drivers.data?.data ?? []).map((d) => ({
    id: d.id,
    name: `${d.preferredName ?? d.firstName} ${d.lastName}`.trim(),
  }));

  return <DriverCertsClient drivers={options} />;
}
