/**
 * /dot/hos — Hours of Service log viewer and entry form.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotDriverDqViewDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { HosClient } from './hos-client';

export const metadata = { title: 'Hours of Service — DOT Compliance — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function HosPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const dqResult = await tryFetch(() =>
    apiServer<DotDriverDqViewDto[]>('/dot/drivers/dq', { accessToken: token ?? null }),
  );

  if (dqResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Hours of Service</h1>
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

  return <HosClient drivers={dqResult.data ?? []} />;
}
