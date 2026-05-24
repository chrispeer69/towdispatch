/**
 * /heavy-duty/jobs/[jobId] — HD job ticket: mark a job heavy-duty, see the
 * eligible trucks + drivers, generate an on-scene estimate, and finalize the
 * invoice. Server-fetches the current HD attributes (null if not marked HD
 * yet) + the rate sheets for the estimate picker.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { HdJobAttributeDto, HdRateSheetDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { HdJobClient } from './job-client';

export const metadata = { title: 'HD Job — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function HdJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<JSX.Element> {
  const { jobId } = await params;
  const token = await getSessionToken();

  const attrs = await tryFetch(() =>
    apiServer<HdJobAttributeDto | null>(`/heavy-duty/jobs/${jobId}/attributes`, {
      accessToken: token ?? null,
    }),
  );

  if (attrs.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Heavy-Duty Job</h1>
        <p className="text-text-secondary-on-dark">Your role does not have access to HD jobs.</p>
        <p className="mt-3">
          <Link href="/heavy-duty" className="text-accent-orange">
            ← Back to heavy-duty
          </Link>
        </p>
      </section>
    );
  }

  const rateSheets = await tryFetch(() =>
    apiServer<HdRateSheetDto[]>('/heavy-duty/rate-sheets', { accessToken: token ?? null }),
  );

  return (
    <HdJobClient
      jobId={jobId}
      initialAttributes={attrs.data ?? null}
      rateSheets={rateSheets.data ?? []}
    />
  );
}
