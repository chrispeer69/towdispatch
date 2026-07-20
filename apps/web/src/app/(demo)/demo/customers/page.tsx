'use client';

/**
 * Demo customers list — shows mock customer accounts.
 */

import { cn } from '@/lib/utils';
import { Building2 } from 'lucide-react';
import { DEMO_CUSTOMERS } from '../mock-data';

const TYPE_LABEL: Record<string, string> = {
  motor_club: 'Motor Club',
  insurance: 'Insurance',
  body_shop: 'Body Shop',
  cash: 'Cash',
  fleet: 'Fleet',
};

const TYPE_TONE: Record<string, string> = {
  motor_club: 'border-info/30 bg-info/10 text-info',
  insurance: 'border-violet/30 bg-violet/10 text-violet',
  body_shop: 'border-warn/30 bg-warn/10 text-warn',
  cash: 'border-divider bg-bg-surface-elevated text-text-secondary-on-dark',
  fleet: 'border-ok/30 bg-ok/10 text-ok',
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function DemoCustomersPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-primary" />
          <div>
            <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
              Customers
            </h1>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              {DEMO_CUSTOMERS.length} accounts - Demo data
            </p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-[10px] bg-brand-primary-hover px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary"
        >
          + Add Customer
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEMO_CUSTOMERS.map((cust) => (
          <div
            key={cust.id}
            className="group rounded-[14px] border border-divider bg-bg-surface p-5 transition-all hover:border-brand-primary/30 hover:shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-primary/15 text-sm font-bold text-brand-primary">
                  {cust.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary-on-dark group-hover:text-brand-primary">
                    {cust.name}
                  </h3>
                  <p className="font-mono text-[11px] text-text-secondary-on-dark/70">
                    {cust.phone}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                  TYPE_TONE[cust.type] ?? 'border-divider text-text-secondary-on-dark',
                )}
              >
                {TYPE_LABEL[cust.type] ?? cust.type}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                  Jobs
                </p>
                <p className="mt-0.5 font-condensed text-lg font-extrabold text-text-primary-on-dark">
                  {cust.jobCount}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                  Revenue
                </p>
                <p className="mt-0.5 font-condensed text-lg font-extrabold text-ok">
                  {currencyFormatter.format(cust.revenueCents / 100)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                  SLA
                </p>
                <p className="mt-0.5 font-condensed text-lg font-extrabold text-text-primary-on-dark">
                  {cust.slaMinutes ? `${cust.slaMinutes}m` : '—'}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-divider pt-3">
              <button
                type="button"
                className="w-full rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-brand-primary/40 hover:text-brand-primary"
              >
                View Details →
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
        Sign up to manage real customer accounts and motor club integrations
      </p>
    </div>
  );
}
