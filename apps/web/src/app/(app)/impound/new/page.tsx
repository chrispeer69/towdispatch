/**
 * /impound/new — vehicle intake form. Server-fetches the yard list so the
 * client can render the yard picker (and an inline "create your first
 * yard" path for fresh tenants).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { ImpoundYardDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { ImpoundIntakeClient } from './intake-client';

export const metadata = { title: 'New impound intake — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function ImpoundIntakePage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const yardsResult = await tryFetch(() =>
    apiServer<ImpoundYardDto[]>('/impound/yards', { accessToken: token ?? null }),
  );

  if (yardsResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">New intake</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have permission to intake vehicles.
        </p>
        <p className="mt-3">
          <Link href="/impound" className="text-accent-orange">
            ← Back to impound
          </Link>
        </p>
      </section>
    );
  }

  return <ImpoundIntakeClient yards={yardsResult.data ?? []} />;
}
