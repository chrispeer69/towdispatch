/**
 * /fraud/[jobId] — job risk detail. Server-fetches the job-risk aggregate
 * (job summary + composite score + signals + disputes) and hands it to the
 * client component that owns the operator actions (score / review / dispute).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { JobRiskDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { FraudJobDetailClient } from './detail-client';

export const metadata = { title: 'Job Risk — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function FraudJobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<JSX.Element> {
  const { jobId } = await params;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<JobRiskDetailDto>(`/fraud-detection/jobs/${jobId}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Job Risk</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to fraud detection.
        </p>
        <p className="mt-3">
          <Link href="/fraud" className="text-accent-orange">
            ← Back to fraud risk
          </Link>
        </p>
      </section>
    );
  }
  if (result.error || !result.data) notFound();

  return <FraudJobDetailClient detail={result.data} />;
}
