import { apiServer, tryFetch } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import type { EvJobDetailDto, JobDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { EvJobClient } from './ev-detail-client';

export const metadata = { title: 'EV recovery — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobEvPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<JSX.Element> {
  await requireUser();
  const { jobId } = await params;
  if (!UUID_RX.test(jobId)) notFound();

  const jobResult = await tryFetch(() => apiServer<JobDto>(`/jobs/${jobId}`));
  if (!jobResult.data) notFound();
  const job = jobResult.data;

  // EV detail 404s when the job has not been marked EV yet — that's expected;
  // the client then shows the "mark as EV recovery" affordance.
  const evResult = await tryFetch(() => apiServer<EvJobDetailDto>(`/ev-recovery/jobs/${jobId}`));

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/jobs/${jobId}`} className="text-accent-orange text-sm">
          ← Job {job.jobNumber}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-1">EV recovery</h1>
        <p className="text-text-secondary-on-dark text-sm mt-0.5">
          Job {job.jobNumber} · {job.serviceType}
        </p>
      </header>
      <EvJobClient jobId={jobId} initialDetail={evResult.data ?? null} />
    </section>
  );
}
