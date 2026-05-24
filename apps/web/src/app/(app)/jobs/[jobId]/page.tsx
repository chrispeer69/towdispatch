import { apiServer, tryFetch } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import type {
  JobDto,
  JobEvidenceWithUrlDto,
  JobServiceType,
  JobStatus,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { EvidenceGrid } from './evidence-grid';

export const metadata = { title: 'Job — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Roles permitted to delete evidence from the UI. The API enforces the
// authoritative allow-list (owner/admin/dispatcher); the operator console
// surfaces the affordance to the admin tier only.
const DELETE_ROLES = new Set(['owner', 'admin']);

const STATUS_LABEL: Record<JobStatus, string> = {
  new: 'New',
  dispatched: 'Dispatched',
  enroute: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  goa: 'GOA',
};

const SERVICE_LABEL: Record<JobServiceType, string> = {
  tow: 'Tow',
  jump_start: 'Jump start',
  lockout: 'Lockout',
  tire_change: 'Tire change',
  fuel: 'Fuel',
  winch: 'Winch',
  recovery: 'Recovery',
  impound: 'Impound',
  other: 'Other',
};

function vehicleLabel(v: JobDto['vehicle']): string {
  if (!v) return '—';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const plate = v.plate ? (v.plateState ? `${v.plate} (${v.plateState})` : v.plate) : '';
  return [ymm, plate].filter(Boolean).join(' · ') || '—';
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<JSX.Element> {
  const { jobId } = await params;
  if (!UUID_RX.test(jobId)) notFound();

  const session = await requireUser();
  const canDelete = DELETE_ROLES.has(session.user.role);

  const jobResult = await tryFetch(() => apiServer<JobDto>(`/jobs/${jobId}`));
  if (!jobResult.data) notFound();
  const job = jobResult.data;

  // Evidence is a secondary fetch; a failure here should degrade to an empty
  // grid rather than 404 the whole page.
  const evidenceResult = await tryFetch(() =>
    apiServer<JobEvidenceWithUrlDto[]>(`/jobs/${jobId}/evidence`),
  );
  const evidence = evidenceResult.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
          <Link href="/jobs" className="hover:text-text-primary-on-dark">
            ← Back to jobs
          </Link>
        </p>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight md:text-2xl">
          Job {job.jobNumber}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary-on-dark">
          <span className="rounded-full border border-divider bg-bg-surface-elevated/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em]">
            {STATUS_LABEL[job.status]}
          </span>
          <span>{SERVICE_LABEL[job.serviceType]}</span>
          <span aria-hidden>·</span>
          <span>{job.customer?.name ?? 'No customer'}</span>
        </p>
      </header>

      <section className="grid gap-4 rounded-[14px] border border-divider bg-bg-surface p-5 sm:grid-cols-2">
        <Field label="Vehicle" value={vehicleLabel(job.vehicle)} />
        <Field label="Pickup" value={job.pickupAddress} />
        <Field label="Drop-off" value={job.dropoffAddress ?? '—'} />
        <Field
          label="Created"
          value={new Date(job.createdAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Evidence
          </h2>
          <span className="text-xs text-text-secondary-on-dark" data-testid="evidence-count">
            {evidence.length} item{evidence.length === 1 ? '' : 's'}
          </span>
        </div>
        <EvidenceGrid jobId={jobId} items={evidence} canDelete={canDelete} />
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
        {label}
      </p>
      <p className="text-sm text-text-primary-on-dark">{value}</p>
    </div>
  );
}
