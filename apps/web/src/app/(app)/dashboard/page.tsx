import { buttonVariants } from '@/components/ui/button';
import { CustomerLink, JobLink } from '@/components/ui/entity-link';
import { apiServer, tryFetch } from '@/lib/api/client';
import { getOptionalUser } from '@/lib/auth/session';
import { cn } from '@/lib/utils';
import type { JobServiceType, JobStatus } from '@ustowdispatch/shared';
import {
  ArrowUpRight,
  ChevronRight,
  Clock,
  type LucideIcon,
  Plus,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Dashboard — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface KpiCardProps {
  label: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
  tone?: 'orange' | 'blue' | 'green' | 'violet';
  href?: string;
  valueAccent?: boolean;
}

interface DashboardRecentActivityItem {
  id: string;
  jobNumber: string;
  customerId: string | null;
  customerName: string | null;
  serviceType: JobServiceType;
  status: JobStatus;
  createdAt: string;
}

interface DashboardDriverOnDuty {
  driverId: string;
  firstName: string;
  lastName: string;
  truckUnitNumber: string | null;
  shiftStatus: string;
  currentJobId: string | null;
  currentJobNumber: string | null;
  currentJobStatus: JobStatus | null;
}

interface DashboardRevenueByDriverItem {
  driverId: string | null;
  driverName: string;
  revenueCents: number;
}

interface DashboardOverviewDto {
  activeCalls: number;
  driversOnDuty: number;
  todaysRevenueCents: number;
  avgEtaMinutes: number | null;
  recentActivity: DashboardRecentActivityItem[];
  driversOnDutyList: DashboardDriverOnDuty[];
  revenueByDriver: DashboardRevenueByDriverItem[];
}

function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'orange',
  href,
  valueAccent = false,
}: KpiCardProps): JSX.Element {
  const accentClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
    orange: 'text-brand-primary bg-brand-primary/15',
    blue: 'text-info bg-info/15',
    green: 'text-ok bg-ok/15',
    violet: 'text-violet bg-violet/15',
  };
  const valueAccentClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
    orange: 'text-brand-primary',
    blue: 'text-info',
    green: 'text-ok',
    violet: 'text-violet',
  };
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${accentClass[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        {href ? <ChevronRight className="h-4 w-4 text-text-secondary-on-dark/40" /> : null}
      </div>
      <p
        className={cn(
          'mt-4 font-condensed text-3xl font-extrabold leading-none',
          valueAccent && valueAccentClass[tone],
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
        {label}
      </p>
      {caption ? (
        <p className="mt-2 text-[11px] text-text-secondary-on-dark/70">{caption}</p>
      ) : null}
    </>
  );
  const baseCls = 'block rounded-[14px] border border-divider bg-bg-surface p-5 transition-colors';
  if (href) {
    return (
      <Link
        href={href}
        className={cn(baseCls, 'hover:border-brand-primary/40 hover:bg-bg-surface-elevated/20')}
      >
        {inner}
      </Link>
    );
  }
  return <div className={baseCls}>{inner}</div>;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const currencyFormatterCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

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

const SHIFT_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  en_route: 'En route',
  on_scene: 'On scene',
  in_progress: 'In progress',
  returning: 'Returning',
  break: 'On break',
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function DashboardPage(): Promise<JSX.Element> {
  // Auth gating is enforced by (app)/layout.tsx. getOptionalUser is the
  // non-throwing variant — a transient /auth/me flake here cannot redirect us
  // out from under a layout that already streamed an authenticated shell.
  const session = await getOptionalUser();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Read-only snapshot. tryFetch surfaces a per-feature 401/403 as data so a
  // missing-scope endpoint can't crash the render. Real session-expiry is
  // handled exclusively by requireUser() in the (app)/ layout.
  const overviewResult = await tryFetch(() =>
    apiServer<DashboardOverviewDto>('/dashboard/overview'),
  );
  const overview: DashboardOverviewDto = overviewResult.data ?? {
    activeCalls: 0,
    driversOnDuty: 0,
    todaysRevenueCents: 0,
    avgEtaMinutes: null,
    recentActivity: [],
    driversOnDutyList: [],
    revenueByDriver: [],
  };

  const activeCallsValue = String(overview.activeCalls);
  const revenueValue = currencyFormatter.format(overview.todaysRevenueCents / 100);
  const etaValue = overview.avgEtaMinutes === null ? '— min' : `${overview.avgEtaMinutes} min`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Operations Overview
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            {today}
            {session ? ` · ${session.tenant.name}` : ''}
          </p>
        </div>
        {session && !session.user.emailVerifiedAt ? (
          <a
            href="/verify-email-pending"
            className="rounded-[10px] border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-primary hover:bg-brand-primary/20"
          >
            Confirm your email →
          </a>
        ) : null}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Active Calls"
          value={activeCallsValue}
          caption="By client →"
          icon={Truck}
          tone="orange"
          href="/active-calls"
        />
        <KpiCard
          label="Today's Revenue"
          value={revenueValue}
          caption="By driver below"
          icon={Wallet}
          tone="green"
          valueAccent
        />
        <KpiCard
          label="Avg ETA"
          value={etaValue}
          caption="Tap to triage breaches →"
          icon={Clock}
          tone="violet"
          href="/active-etas"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <DriversOnDutyCard list={overview.driversOnDutyList} totalCount={overview.driversOnDuty} />
        <RevenueByDriverCard
          list={overview.revenueByDriver}
          totalCents={overview.todaysRevenueCents}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-[14px] border border-divider bg-bg-surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
              Recent Activity
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
              Live feed
            </span>
          </div>
          {overview.recentActivity.length === 0 ? (
            <div className="mt-6 flex h-44 flex-col items-center justify-center rounded-[10px] border border-dashed border-divider bg-bg-surface-elevated/20 text-center">
              <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
                Your first job will show here.
              </p>
              <p className="mt-1 max-w-md text-sm text-text-secondary-on-dark">
                Welcome aboard — once dispatch starts assigning calls, this feed lights up in real
                time.
              </p>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-divider rounded-[10px] border border-divider bg-bg-surface-elevated/10">
              {overview.recentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
                    {formatTime(item.createdAt)}
                  </span>
                  <span className="flex-1 truncate font-medium">
                    <JobLink jobId={item.id}>#{item.jobNumber}</JobLink>
                    <span className="mx-1.5 text-text-secondary-on-dark">—</span>
                    {item.customerId ? (
                      <CustomerLink customerId={item.customerId}>
                        {item.customerName ?? 'Unknown customer'}
                      </CustomerLink>
                    ) : (
                      <span className="text-text-primary-on-dark">
                        {item.customerName ?? 'Unknown customer'}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-text-secondary-on-dark">
                    {SERVICE_LABEL[item.serviceType]}
                  </span>
                  <span className="rounded-full border border-divider bg-bg-surface px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                    {STATUS_LABEL[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
          <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
            Quick Actions
          </h3>
          <p className="mt-1 text-xs text-text-secondary-on-dark">Get the day moving.</p>
          <ul className="mt-5 space-y-3">
            <li>
              <Link
                href="/intake"
                className={cn(buttonVariants({ variant: 'default' }), 'w-full justify-between')}
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New call
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </li>
            <li>
              <Link
                href="/fleet/drivers/new"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-between')}
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Add driver
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </li>
            <li>
              <Link
                href="/customers/new"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-between')}
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add customer
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </li>
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
            More actions unlock as integrations connect.
          </p>
        </div>
      </section>
    </div>
  );
}

function DriversOnDutyCard({
  list,
  totalCount,
}: {
  list: DashboardDriverOnDuty[];
  totalCount: number;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Drivers On Duty
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          {list.length} of {totalCount}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="mt-6 flex h-32 flex-col items-center justify-center rounded-[10px] border border-dashed border-divider bg-bg-surface-elevated/20 text-center">
          <p className="text-sm text-text-secondary-on-dark">No drivers are clocked in yet.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-divider bg-bg-surface-elevated/10">
          <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3 border-b border-divider bg-bg-surface-elevated/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/70">
            <span>Name</span>
            <span>Truck</span>
            <span className="justify-self-end">Status</span>
          </div>
          <ul className="divide-y divide-divider">
            {list.map((d) => {
              // When the shift has a current job, the job status is the
              // dispatcher-relevant signal (en route → on scene → in progress).
              // Between calls, fall back to the shift's own status.
              const statusLabel = d.currentJobStatus
                ? STATUS_LABEL[d.currentJobStatus]
                : (SHIFT_STATUS_LABEL[d.shiftStatus] ?? d.shiftStatus);
              const onCall = Boolean(d.currentJobId);
              return (
                <li
                  key={d.driverId}
                  className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 px-4 py-3 text-sm"
                >
                  <Link
                    href={`/fleet/drivers/${d.driverId}`}
                    className="truncate font-medium hover:text-brand-primary hover:underline underline-offset-2"
                  >
                    {d.firstName} {d.lastName}
                  </Link>
                  <span className="font-mono text-[11px] text-text-secondary-on-dark">
                    {d.truckUnitNumber ? `Truck ${d.truckUnitNumber}` : '— no truck'}
                  </span>
                  <span
                    className={cn(
                      'justify-self-end rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.14em]',
                      onCall
                        ? 'border-brand-primary/40 bg-brand-primary/10 text-brand-primary'
                        : 'border-divider bg-bg-surface text-text-secondary-on-dark',
                    )}
                  >
                    {statusLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function RevenueByDriverCard({
  list,
  totalCents,
}: {
  list: DashboardRevenueByDriverItem[];
  totalCents: number;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Today's Revenue
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ok">
          {currencyFormatter.format(totalCents / 100)} total
        </span>
      </div>
      <p className="mt-1 text-[11px] text-text-secondary-on-dark/70">
        Updated on page load. Tap a driver to see their day.
      </p>
      {list.length === 0 ? (
        <div className="mt-6 flex h-32 flex-col items-center justify-center rounded-[10px] border border-dashed border-divider bg-bg-surface-elevated/20 text-center">
          <p className="text-sm text-text-secondary-on-dark">No paid invoices yet today.</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-divider rounded-[10px] border border-divider bg-bg-surface-elevated/10">
          {list.map((r) => (
            <li
              key={r.driverId ?? 'unassigned'}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              {r.driverId ? (
                <Link
                  href={`/fleet/drivers/${r.driverId}/today`}
                  className="font-medium hover:text-brand-primary hover:underline underline-offset-2"
                >
                  {r.driverName}
                </Link>
              ) : (
                <span className="font-medium italic text-text-secondary-on-dark">
                  {r.driverName}
                </span>
              )}
              <span className="font-mono text-sm font-semibold tabular-nums text-ok">
                {currencyFormatterCents.format(r.revenueCents / 100)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
