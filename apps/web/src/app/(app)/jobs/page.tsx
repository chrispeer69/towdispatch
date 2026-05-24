import { CustomerLink, JobLink, VehicleLink } from '@/components/ui/entity-link';
import { apiServer, tryFetch } from '@/lib/api/client';
import type {
  JobListItemDto,
  JobServiceType,
  JobStatus,
  PaginatedJobs,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Tow Jobs â€” US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

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
  repo: 'Repossession',
  other: 'Other',
};

const PER_PAGE = 50;

interface SearchParams {
  page?: string;
}

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function vehicleLabel(v: JobListItemDto['vehicle']): string {
  if (!v) return 'â€”';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const plate = v.plate ? (v.plateState ? `${v.plate} (${v.plateState})` : v.plate) : '';
  if (ymm && plate) return `${ymm} Â· ${plate}`;
  return ymm || plate || 'â€”';
}

function driverLabel(d: JobListItemDto['driver']): string {
  if (!d) return 'Unassigned';
  return `${d.firstName} ${d.lastName}`;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const parsedPage = Number(params.page);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;

  // Auth is enforced by (app)/layout.tsx. tryFetch surfaces a per-feature
  // 401/403 as data so this page never races the layout's redirect.
  const result = await tryFetch(() =>
    apiServer<PaginatedJobs>(`/jobs?page=${page}&perPage=${PER_PAGE}`),
  );
  const list: PaginatedJobs = result.data ?? { data: [], page, perPage: PER_PAGE, total: 0 };

  const totalPages = Math.max(1, Math.ceil(list.total / list.perPage));
  const hasPrev = list.page > 1;
  const hasNext = list.page < totalPages;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Tow Jobs
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            <span data-testid="jobs-total">{list.total}</span> total Â· newest first
          </p>
        </div>
      </header>

      {list.data.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-center">
          <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Your first job will show here.
          </p>
          <p className="mt-1 max-w-md text-sm text-text-secondary-on-dark">
            Take a call from{' '}
            <Link href="/intake" className="text-brand-primary hover:underline">
              Intake
            </Link>{' '}
            and it will appear in this list.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
            <table className="w-full divide-y divide-divider text-sm" data-testid="jobs-table">
              <thead className="bg-bg-surface-elevated/30">
                <tr className="text-left">
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Created
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Customer
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Vehicle
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Service
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Status
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Driver
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                    Pickup
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {list.data.map((job) => (
                  <tr key={job.id} className="hover:bg-bg-surface-elevated/20">
                    <td className="px-4 py-2 font-mono text-xs">
                      <JobLink jobId={job.id}>{formatCreatedAt(job.createdAt)}</JobLink>
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {job.customer?.id && job.customer.name ? (
                        <CustomerLink customerId={job.customer.id}>
                          {job.customer.name}
                        </CustomerLink>
                      ) : (
                        <span className="text-text-primary-on-dark">
                          {job.customer?.name ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {job.vehicle?.id ? (
                        <VehicleLink
                          vehicleId={job.vehicle.id}
                          className="text-text-secondary-on-dark hover:text-brand-primary hover:underline underline-offset-2 transition-colors"
                        >
                          {vehicleLabel(job.vehicle)}
                        </VehicleLink>
                      ) : (
                        <span className="text-text-secondary-on-dark">
                          {vehicleLabel(job.vehicle)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {SERVICE_LABEL[job.serviceType]}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full border border-divider bg-bg-surface-elevated/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                        {STATUS_LABEL[job.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {driverLabel(job.driver)}
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">{job.pickupAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-text-secondary-on-dark-on-dark/60">
            <span>
              Page {list.page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              {hasPrev ? (
                <Link
                  href={`/jobs?page=${list.page - 1}`}
                  className="rounded-md border border-divider px-3 py-1 hover:bg-bg-surface-elevated/30"
                >
                  â† Prev
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-md border border-divider px-3 py-1 opacity-50">
                  â† Prev
                </span>
              )}
              {hasNext ? (
                <Link
                  href={`/jobs?page=${list.page + 1}`}
                  className="rounded-md border border-divider px-3 py-1 hover:bg-bg-surface-elevated/30"
                >
                  Next â†’
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-md border border-divider px-3 py-1 opacity-50">
                  Next â†’
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
