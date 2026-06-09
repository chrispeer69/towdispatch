/**
 * /dot/drivers — Driver Qualification (DQ) file dashboard.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotDriverDqViewDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { DqDashboardClient } from './dq-dashboard-client';

export const metadata = { title: 'Driver Qualifications — DOT Compliance — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function DriversPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const dqResult = await tryFetch(() =>
    apiServer<DotDriverDqViewDto[]>('/dot/drivers/dq', { accessToken: token ?? null }),
  );

  if (dqResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Driver Qualifications</h1>
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

  return <DqDashboardClient drivers={dqResult.data ?? []} />;
}
