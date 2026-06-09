/**
 * /fraud/disputes — the dispute log. Server-fetches the tenant's disputes
 * (last 90 days) and hands them to the client component that owns resolve +
 * outcome-entry actions. Same RBAC as the rest of fraud detection.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DisputeRecordDto, DisputeStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { FraudDisputesClient } from './disputes-client';

export const metadata = { title: 'Dispute Log — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const KNOWN: DisputeStatus[] = ['open', 'won', 'lost', 'withdrawn', 'partial'];

export default async function FraudDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: DisputeStatus }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const status = params.status && KNOWN.includes(params.status) ? params.status : null;
  const token = await getSessionToken();

  const qs = new URLSearchParams();
  qs.set('days', '90');
  if (status) qs.set('status', status);

  const result = await tryFetch(() =>
    apiServer<DisputeRecordDto[]>(`/fraud-detection/disputes?${qs.toString()}`, {
      accessToken: token ?? null,
    }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Dispute Log</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to fraud detection.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  return <FraudDisputesClient disputes={result.data ?? []} status={status} />;
}
