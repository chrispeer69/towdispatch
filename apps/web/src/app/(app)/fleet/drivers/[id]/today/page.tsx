/**
 * /fleet/drivers/[id]/today — driver's day. Opened from the Today's
 * Revenue panel on Operations Overview. Lists completed jobs and paid
 * invoices for the UTC day (matches the dashboard counter's window) so
 * the dispatcher can see what made up that driver's number.
 */
import { InvoiceLink, JobLink } from '@/components/ui/entity-link';
import { apiServer, tryFetch } from '@/lib/api/client';
import type { JobServiceType, JobStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

export const metadata = { title: "Driver's Day — US Tow DISPATCH" };
export const dynamic = 'force-dynamic';

interface DriverDayJobItem {
  id: string;
  jobNumber: string;
  status: JobStatus;
  serviceType: JobServiceType;
  customerName: string | null;
  accountName: string | null;
  rateQuotedCents: number;
  createdAt: string;
}

interface DriverDayInvoiceItem {
  id: string;
  invoiceNumber: string;
  status: string;
  totalCents: number;
  paidCents: number;
  paidAt: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerName: string | null;
}

interface DriverDayDto {
  driverId: string;
  firstName: string;
  lastName: string;
  completedJobs: DriverDayJobItem[];
  invoices: DriverDayInvoiceItem[];
  totalRevenueCents: number;
}

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

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function DriverDayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const res = await tryFetch(() => apiServer<DriverDayDto>(`/dashboard/driver-day/${id}`));
  if (!res.data) notFound();
  const data = res.data;
  if (!data.firstName && !data.lastName) notFound();

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          <Link href="/dashboard" className="hover:text-text-primary-on-dark">
            ← Operations Overview
          </Link>
        </p>
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
              {data.firstName} {data.lastName} — Today
            </h1>
            <p className="mt-1 text-sm text-text-secondary-on-dark">{today}</p>
          </div>
          <Link
            href={`/fleet/drivers/${data.driverId}`}
            className="rounded-[10px] border border-divider px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] hover:border-brand-primary/40 hover:text-brand-primary"
          >
            Driver profile →
          </Link>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
            Revenue today
          </p>
          <p className="mt-2 font-condensed text-3xl font-extrabold leading-none text-ok">
            {currencyFormatter.format(data.totalRevenueCents / 100)}
          </p>
        </div>
        <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
            Completed jobs
          </p>
          <p className="mt-2 font-condensed text-3xl font-extrabold leading-none">
            {data.completedJobs.length}
          </p>
        </div>
        <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
            Paid invoices
          </p>
          <p className="mt-2 font-condensed text-3xl font-extrabold leading-none">
            {data.invoices.length}
          </p>
        </div>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Completed Jobs
        </h3>
        {data.completedJobs.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary-on-dark">No jobs completed yet today.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[10px] border border-divider">
            <table className="w-full divide-y divide-divider text-sm">
              <thead className="bg-bg-surface-elevated/30">
                <tr className="text-left">
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Time
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Job
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Service
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Customer
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Client
                  </th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Quoted
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {data.completedJobs.map((j) => (
                  <tr key={j.id} className="hover:bg-bg-surface-elevated/20">
                    <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                      {formatTime(j.createdAt)}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <JobLink jobId={j.id}>#{j.jobNumber}</JobLink>
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {SERVICE_LABEL[j.serviceType]}
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {j.customerName ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {j.accountName ?? <span className="italic">Cash</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {currencyFormatter.format(j.rateQuotedCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Paid Invoices
        </h3>
        {data.invoices.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary-on-dark">
            No invoices paid against this driver's jobs today.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[10px] border border-divider">
            <table className="w-full divide-y divide-divider text-sm">
              <thead className="bg-bg-surface-elevated/30">
                <tr className="text-left">
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Paid
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Invoice
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Job
                  </th>
                  <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Customer
                  </th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Total
                  </th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark/60">
                    Paid
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-bg-surface-elevated/20">
                    <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                      {formatTime(inv.paidAt)}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <InvoiceLink invoiceId={inv.id}>#{inv.invoiceNumber}</InvoiceLink>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {inv.jobId && inv.jobNumber ? (
                        <JobLink jobId={inv.jobId}>#{inv.jobNumber}</JobLink>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-secondary-on-dark">
                      {inv.customerName ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {currencyFormatter.format(inv.totalCents / 100)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-semibold tabular-nums text-ok">
                      {currencyFormatter.format(inv.paidCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
