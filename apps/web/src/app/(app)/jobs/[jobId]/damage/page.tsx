import { apiServer, tryFetch } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import type {
  DamageAnalysisDetailDto,
  DamageAnalysisDto,
  JobDto,
  JobEvidenceWithUrlDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { DamageClient } from './damage-client';

export const metadata = { title: 'Damage analysis — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES = new Set(['owner', 'admin', 'dispatcher']);

function vehicleLabel(v: JobDto['vehicle']): string {
  if (!v) return 'Vehicle';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ');
  return ymm || 'Vehicle';
}

export default async function JobDamagePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<JSX.Element> {
  const { jobId } = await params;
  if (!UUID_RX.test(jobId)) notFound();

  const session = await requireUser();
  const canWrite = WRITE_ROLES.has(session.user.role);

  const jobResult = await tryFetch(() => apiServer<JobDto>(`/jobs/${jobId}`));
  if (!jobResult.data) notFound();
  const job = jobResult.data;

  const evidenceResult = await tryFetch(() =>
    apiServer<JobEvidenceWithUrlDto[]>(`/jobs/${jobId}/evidence`),
  );
  const evidence = (evidenceResult.data ?? []).filter((e) => e.kind.startsWith('photo'));

  const listResult = await tryFetch(() =>
    apiServer<DamageAnalysisDto[]>(`/damage-analysis?jobId=${jobId}`),
  );
  const summaries = listResult.data ?? [];

  // Hydrate each analysis with its findings for the detail view.
  const analyses = (
    await Promise.all(
      summaries.map((a) =>
        tryFetch(() => apiServer<DamageAnalysisDetailDto>(`/damage-analysis/${a.id}`)),
      ),
    )
  )
    .map((r) => r.data)
    .filter((d): d is DamageAnalysisDetailDto => d !== null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
          <Link href={`/jobs/${jobId}`} className="hover:text-text-primary-on-dark">
            ← Back to job {job.jobNumber}
          </Link>
        </p>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight md:text-2xl">
          Damage analysis
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          {vehicleLabel(job.vehicle)} · Job {job.jobNumber}
        </p>
      </header>

      <DamageClient
        jobId={jobId}
        vehicle={{
          make: job.vehicle?.make ?? undefined,
          model: job.vehicle?.model ?? undefined,
          year: job.vehicle?.year ?? undefined,
        }}
        evidence={evidence.map((e) => ({
          id: e.id,
          s3Key: e.s3Key,
          downloadUrl: e.downloadUrl ?? null,
        }))}
        analyses={analyses}
        canWrite={canWrite}
      />
    </div>
  );
}
