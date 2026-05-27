'use client';

/**
 * Demo dashboard — mirrors the real dashboard but with hardcoded mock data.
 * No API calls. All state is client-side only.
 */

import { cn } from '@/lib/utils';
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
import {
  DEMO_ACTIVE_CALLS,
  DEMO_AVG_ETA_MINUTES,
  DEMO_DRIVERS,
  DEMO_JOBS,
  DEMO_REVENUE_BY_DRIVER,
  DEMO_TENANT,
  DEMO_TODAYS_REVENUE_CENTS,
  type DemoDriver,
  type DemoRevenueByDriver,
} from './mock-data';

// ─── KPI Card ───────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
  tone?: 'orange' | 'blue' | 'green' | 'violet';
  href?: string;
  valueAccent?: boolean;
}

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

function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'orange',
  href,
  valueAccent = false,
}: KpiCardProps): JSX.Element {
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
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
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

// ─── Formatters ─────────────────────────────────────────────────────

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

const STATUS_LABEL: Record<string, string> = {
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

const SERVICE_LABEL: Record<string, string> = {
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

// ─── Sub-components ─────────────────────────────────────────────────

function DriversOnDutyCard({
  list,
}: {
  list: DemoDriver[];
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Drivers On Duty
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
          {list.length} of {list.length}
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-[10px] border border-divider bg-bg-surface-elevated/10">
        <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3 border-b border-divider bg-bg-surface-elevated/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/70">
          <span>Name</span>
          <span>Truck</span>
          <span className="justify-self-end">Status</span>
        </div>
        <ul className="divide-y divide-divider">
          {list.map((d) => {
            const statusLabel = d.currentJobStatus
              ? (STATUS_LABEL[d.currentJobStatus] ?? d.currentJobStatus)
              : (SHIFT_STATUS_LABEL[d.shiftStatus] ?? d.shiftStatus);
            const onCall = Boolean(d.currentJobId);
            return (
              <li
                key={d.driverId}
                className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="truncate font-medium hover:text-brand-primary">
                  {d.firstName} {d.lastName}
                </span>
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
    </div>
  );
}

function RevenueByDriverCard({
  list,
  totalCents,
}: {
  list: DemoRevenueByDriver[];
  totalCents: number;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-divider bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
          Today&apos;s Revenue
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ok">
          {currencyFormatter.format(totalCents / 100)} total
        </span>
      </div>
      <p className="mt-1 text-[11px] text-text-secondary-on-dark/70">
        Tap a driver to see their day.
      </p>
      <ul className="mt-4 divide-y divide-divider rounded-[10px] border border-divider bg-bg-surface-elevated/10">
        {list.map((r) => (
          <li
            key={r.driverId ?? 'unassigned'}
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <span className="font-medium hover:text-brand-primary">{r.driverName}</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-ok">
              {currencyFormatterCents.format(r.revenueCents / 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function DemoDashboard(): JSX.Element {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const recentJobs = DEMO_JOBS.slice(0, 5);
  const revenueValue = currencyFormatter.format(DEMO_TODAYS_REVENUE_CENTS / 100);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Operations Overview
          </h1>
          <p suppressHydrationWarning className="mt-1 text-sm text-text-secondary-on-dark">
            {today} · {DEMO_TENANT.name}
          </p>
        </div>
      </header>

      {/* KPI Cards */}
      <section id="demo-kpi-section" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Active Calls"
          value={String(DEMO_ACTIVE_CALLS)}
          caption="By client →"
          icon={Truck}
          tone="orange"
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
          value={`${DEMO_AVG_ETA_MINUTES} min`}
          caption="Tap to triage breaches →"
          icon={Clock}
          tone="violet"
        />
      </section>

      {/* Drivers + Revenue */}
      <section id="demo-drivers-section" className="grid gap-6 lg:grid-cols-2">
        <DriversOnDutyCard list={DEMO_DRIVERS} />
        <RevenueByDriverCard list={DEMO_REVENUE_BY_DRIVER} totalCents={DEMO_TODAYS_REVENUE_CENTS} />
      </section>

      {/* Recent Activity + Quick Actions */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-[14px] border border-divider bg-bg-surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
              Recent Activity
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
              Live feed
            </span>
          </div>
          <ul className="mt-6 divide-y divide-divider rounded-[10px] border border-divider bg-bg-surface-elevated/10">
            {recentJobs.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
                  {formatTime(item.createdAt)}
                </span>
                <span className="flex-1 truncate font-medium">
                  <span className="text-brand-primary">#{item.jobNumber}</span>
                  <span className="mx-1.5 text-text-secondary-on-dark">—</span>
                  <span className="text-text-primary-on-dark">
                    {item.customerName ?? 'Unknown customer'}
                  </span>
                </span>
                <span className="text-xs text-text-secondary-on-dark">
                  {SERVICE_LABEL[item.serviceType] ?? item.serviceType}
                </span>
                <span className="rounded-full border border-divider bg-bg-surface px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div
          id="demo-quick-actions"
          className="rounded-[14px] border border-divider bg-bg-surface p-5"
        >
          <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
            Quick Actions
          </h3>
          <p className="mt-1 text-xs text-text-secondary-on-dark">Get the day moving.</p>
          <ul className="mt-5 space-y-3">
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[10px] bg-brand-primary-hover px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New call
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[10px] border border-divider bg-bg-surface-elevated px-4 py-2.5 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Add driver
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-[10px] border border-divider bg-bg-surface-elevated px-4 py-2.5 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add customer
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </li>
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
            Sign up to unlock full editing.
          </p>
        </div>
      </section>
    </div>
  );
}
