/**
 * /active-calls/[accountId] — filtered active-calls list for one client tile.
 * `accountId` is either a real UUID or the literal "cash" segment which maps
 * to the no-account bucket (walk-up tows, retail credit-card jobs).
 */
import { CustomerLink, JobLink } from '@/components/ui/entity-link';
import { apiServer, tryFetch } from '@/lib/api/client';
import type { AccountDto, JobServiceType, JobStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

export const metadata = { title: 'Active Calls — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

interface DashboardRecentActivityItem {
  id: string;
  jobNumber: string;
  customerId: string | null;
  customerName: string | null;
  serviceType: JobServiceType;
  status: JobStatus;
  createdAt: string;
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function ActiveCallsForAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}): Promise<JSX.Element> {
  const { accountId } = await params;
  const isCash = accountId === 'cash';
  if (!isCash && !UUID_RE.test(accountId)) notFound();

  const [listRes, accountRes] = await Promise.all([
    tryFetch(() =>
      apiServer<DashboardRecentActivityItem[]>(
        isCash
          ? '/dashboard/active-calls/no-account'
          : `/dashboard/active-calls/account/${accountId}`,
      ),
    ),
    isCash
      ? Promise.resolve({ data: null as AccountDto | null, status: 200, error: null })
      : tryFetch(() => apiServer<AccountDto>(`/accounts/${accountId}`)),
  ]);

  const list = listRes.data ?? [];
  const account = accountRes.data;
  const heading = isCash ? 'Cash / No account' : (account?.name ?? 'Account');
  const subline = isCash
    ? 'Walk-up tows and retail credit-card jobs'
    : account
      ? account.isMotorClub
        ? 'Motor club'
        : 'Commercial account'
      : '';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          <Link href="/active-calls" className="hover:text-text-primary-on-dark">
            ← All clients
          </Link>
        </p>
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
              {heading}
            </h1>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              <span className="font-condensed text-base font-extrabold text-text-primary-on-dark">
                {list.length}
              </span>{' '}
              active call{list.length === 1 ? '' : 's'}
              {subline ? ` · ${subline}` : ''}
            </p>
          </div>
          {!isCash && account ? (
            <Link
              href={`/accounts/${account.id}`}
              className="rounded-[10px] border border-divider px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] hover:border-brand-primary/40 hover:text-brand-primary"
            >
              Account profile →
            </Link>
          ) : null}
        </div>
      </header>

      {list.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-center">
          <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            No active calls for this client.
          </p>
          <p className="mt-1 max-w-md text-sm text-text-secondary-on-dark">
            Once a call is dispatched it will appear here until it moves to completed or cancelled.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface-elevated/30">
              <tr className="text-left">
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Started
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Job
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Customer
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Service
                </th>
                <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {list.map((j) => (
                <tr key={j.id} className="hover:bg-bg-surface-elevated/20">
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                    {formatCreatedAt(j.createdAt)}
                  </td>
                  <td className="px-4 py-2 font-medium">
                    <JobLink jobId={j.id}>#{j.jobNumber}</JobLink>
                  </td>
                  <td className="px-4 py-2">
                    {j.customerId && j.customerName ? (
                      <CustomerLink customerId={j.customerId}>{j.customerName}</CustomerLink>
                    ) : (
                      <span className="text-text-secondary-on-dark">{j.customerName ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-secondary-on-dark">
                    {SERVICE_LABEL[j.serviceType]}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full border border-divider bg-bg-surface-elevated/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                      {STATUS_LABEL[j.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
