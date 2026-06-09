import { buttonVariants } from '@/components/ui/button';
import { apiServer, tryFetch } from '@/lib/api/client';
import { getOptionalUser } from '@/lib/auth/session';
import { cn } from '@/lib/utils';
import type { JobServiceType, JobStatus } from '@towdispatch/shared';
import { ArrowUpRight, Clock, type LucideIcon, Plus, Truck, Users, Wallet } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Dashboard â€” Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  icon: LucideIcon;
  tone?: 'orange' | 'blue' | 'green' | 'violet';
}

interface DashboardRecentActivityItem {
  id: string;
  jobNumber: string;
  customerName: string | null;
  serviceType: JobServiceType;
  status: JobStatus;
  createdAt: string;
}

interface DashboardOverviewDto {
  activeCalls: number;
  driversOnDuty: number;
  todaysRevenueCents: number;
  avgEtaMinutes: number | null;
  recentActivity: DashboardRecentActivityItem[];
}

function KpiCard({ label, value, delta, icon: Icon, tone = 'orange' }: KpiCardProps): JSX.Element {
  const accentClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
    orange: 'text-brand-primary bg-brand-primary/15',
    blue: 'text-info bg-info/15',
    green: 'text-ok bg-ok/15',
    violet: 'text-violet bg-violet/15',
  };
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${accentClass[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        {delta ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
            {delta}
          </span>
        ) : null}
      </div>
      <p className="mt-4 font-condensed text-3xl font-extrabold leading-none">{value}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
        {label}
      </p>
    </div>
  );
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function DashboardPage(): Promise<JSX.Element> {
  // Auth gating is enforced by (app)/layout.tsx. getOptionalUser is the
  // non-throwing variant â€” a transient /auth/me flake here cannot redirect us
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
  };

  const activeCallsValue = String(overview.activeCalls);
  const driversValue = String(overview.driversOnDuty);
  const revenueValue = currencyFormatter.format(overview.todaysRevenueCents / 100);
  const etaValue = overview.avgEtaMinutes === null ? 'â€” min' : `${overview.avgEtaMinutes} min`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Operations Overview
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            {today}
            {session ? ` Â· ${session.tenant.name}` : ''}
          </p>
        </div>
        {session && !session.user.emailVerifiedAt ? (
          <a
            href="/verify-email-pending"
            className="rounded-[10px] border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-primary hover:bg-brand-primary/20"
          >
            Confirm your email â†’
          </a>
        ) : null}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active Calls"
          value={activeCallsValue}
          delta="â€”"
          icon={Truck}
          tone="orange"
        />
        <KpiCard
          label="Drivers On Duty"
          value={driversValue}
          delta="â€”"
          icon={Users}
          tone="blue"
        />
        <KpiCard
          label="Today's Revenue"
          value={revenueValue}
          delta="â€”"
          icon={Wallet}
          tone="green"
        />
        <KpiCard label="Avg ETA" value={etaValue} delta="â€”" icon={Clock} tone="violet" />
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
                Welcome aboard â€” once dispatch starts assigning calls, this feed lights up in real
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
                  <span className="flex-1 truncate font-medium text-text-primary-on-dark">
                    {item.customerName ?? 'Unknown customer'}
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
