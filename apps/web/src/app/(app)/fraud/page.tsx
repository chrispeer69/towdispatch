/**
 * /fraud — risk queue. Server-fetches the high/critical-risk jobs scored in
 * the last 30 days and hands them to the client list. AUDITOR is read-only;
 * MANAGER / ACCOUNTING / DRIVER get a 403 explainer (same RBAC as reporting).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { FraudRiskBand, HighRiskListItemDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { FraudQueueClient } from './queue-client';

export const metadata = { title: 'Fraud Risk — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const KNOWN_BANDS: FraudRiskBand[] = ['low', 'medium', 'high', 'critical'];

interface SearchParams {
  band?: FraudRiskBand;
}

export default async function FraudQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const band = params.band && KNOWN_BANDS.includes(params.band) ? params.band : null;
  const token = await getSessionToken();

  const qs = new URLSearchParams();
  if (band) qs.set('band', band);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const result = await tryFetch(() =>
    apiServer<HighRiskListItemDto[]>(`/fraud-detection/high-risk${suffix}`, {
      accessToken: token ?? null,
    }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Fraud Risk</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to fraud detection. Ask an owner or admin to extend your
          permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  return <FraudQueueClient items={result.data ?? []} band={band} />;
}
