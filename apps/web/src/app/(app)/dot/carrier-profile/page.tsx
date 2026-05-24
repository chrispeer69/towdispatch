/**
 * /dot/carrier-profile — view + edit the tenant FMCSA carrier profile.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotCarrierProfileDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { CarrierProfileClient } from './carrier-profile-client';

export const metadata = { title: 'Carrier Profile — DOT Compliance — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function CarrierProfilePage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const profileResult = await tryFetch(() =>
    apiServer<DotCarrierProfileDto | null>('/dot/carrier-profile', { accessToken: token ?? null }),
  );

  if (profileResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Carrier Profile</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the DOT Compliance module. Ask an owner or admin to
          extend your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dot" className="text-accent-orange">
            ← Back to DOT Compliance
          </Link>
        </p>
      </section>
    );
  }

  return <CarrierProfileClient profile={profileResult.data ?? null} />;
}
