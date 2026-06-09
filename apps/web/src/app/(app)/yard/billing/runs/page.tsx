/**
 * /yard/billing/runs — the storage auto-billing run log + a manual "run now"
 * trigger (Yard Management, Session 54).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { StorageBillingRunDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { BillingRunsClient } from './billing-runs-client';

export const metadata = { title: 'Storage Billing Runs — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function BillingRunsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const runs = await tryFetch(() =>
    apiServer<StorageBillingRunDto[]>('/yard/billing/runs', { accessToken: token ?? null }),
  );
  if (runs.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Storage Billing Runs</h1>
        <p className="text-text-secondary-on-dark">No access to yard management.</p>
        <Link href="/dashboard" className="mt-3 block text-accent-orange">
          ← Dashboard
        </Link>
      </section>
    );
  }
  return <BillingRunsClient initial={runs.data ?? []} />;
}
