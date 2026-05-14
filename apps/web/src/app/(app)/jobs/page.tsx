import { apiServer, tryFetch } from '@/lib/api/client';
import { getRequestId } from '@/lib/debug/redirect-trace';
import type { JobListItemDto, JobServiceType, JobStatus, PaginatedJobs } from '@towcommand/shared';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Tow Jobs — TowCommand' };
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
  if (!v) return '—';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const plate = v.plate ? (v.plateState ? `${v.plate} (${v.plateState})` : v.plate) : '';
  if (ymm && plate) return `${ymm} · ${plate}`;
  return ymm || plate || '—';
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
  // [FLEET_DEBUG_V2] — working-route comparison.
  const rid = getRequestId();
  // eslint-disable-next-line no-console
  console.error(`[FLEET_DEBUG_V2 rid=${rid}] jobs/page enter (working comparison)`);
  const params = await searchParams;
  const parsedPage = Number(params.page);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;

  // Auth is enforced by (app)/layout.tsx. tryFetch surfaces a per-feature
  // 401/403 as data so this page never races the layout's redirect.
  const result = await tryFetch(() =>
    apiServer<PaginatedJobs>(`/jobs?page=${page}&perPage=${PER_PAGE}`),
  );
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG_V2 rid=${rid}] jobs/page tryFetch=${result.data ? `ok total=${result.data.total}` : `err status=${result.error?.status} code=${result.error?.code} msg=${result.error?.message}`}`,
  );
  const list: PaginatedJobs = result.data ?? { data: [], page, perPage: PER_PAGE, total: 0 };

  const totalPages = Math.max(1, Math.ceil(list.total / list.perPage));
  const hasPrev = list.page > 1;
  const hasNext = list.page < totalPages;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Tow Jobs
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span data-testid="jobs-total">{list.total}</span> total · newest first
          </p>
        </div>
      </header>

      {list.data.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-[14px] border border-dashed border-steel-border bg-steel-mid/40 text-center">
          <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
            Your first job will show here.
          </p>
          <p className="mt-1 max-w-md text-sm text-text-secondary">
            Take a call from{' '}
            <Link href="/intake" className="text-orange-light hover:underline">
              Intake
            </Link>{' '}
            and it will appear in this list.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-[14px] border border-steel-border bg-steel-mid">
            <table className="w-full divide-y divide-steel-border text-sm" data-testid="jobs-table">
              <thead className="bg-steel-light/30">
                <tr className="text-left">
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Created
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Customer
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Vehicle
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Service
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Status
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Driver
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                    Pickup
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-border">
                {list.data.map((job) => (
                  <tr key={job.id} className="hover:bg-steel-light/20">
                    <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                      {formatCreatedAt(job.createdAt)}
                    </td>
                    <td className="px-4 py-2 font-medium text-text-primary">
                      {job.customer?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{vehicleLabel(job.vehicle)}</td>
                    <td className="px-4 py-2 text-text-secondary">
                      {SERVICE_LABEL[job.serviceType]}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full border border-steel-border bg-steel-light/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary">
                        {STATUS_LABEL[job.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{driverLabel(job.driver)}</td>
                    <td className="px-4 py-2 text-text-secondary">{job.pickupAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              Page {list.page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              {hasPrev ? (
                <Link
                  href={`/jobs?page=${list.page - 1}`}
                  className="rounded-md border border-steel-border px-3 py-1 hover:bg-steel-light/30"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-md border border-steel-border px-3 py-1 opacity-50">
                  ← Prev
                </span>
              )}
              {hasNext ? (
                <Link
                  href={`/jobs?page=${list.page + 1}`}
                  className="rounded-md border border-steel-border px-3 py-1 hover:bg-steel-light/30"
                >
                  Next →
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-md border border-steel-border px-3 py-1 opacity-50">
                  Next →
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
