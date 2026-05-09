import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import { ArrowUpRight, Clock, type LucideIcon, Plus, Truck, Users, Wallet } from 'lucide-react';

export const metadata = { title: 'Dashboard — TowCommand' };

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  icon: LucideIcon;
  tone?: 'orange' | 'blue' | 'green' | 'violet';
}

function KpiCard({ label, value, delta, icon: Icon, tone = 'orange' }: KpiCardProps): JSX.Element {
  const accentClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
    orange: 'text-orange-light bg-orange/15',
    blue: 'text-info bg-info/15',
    green: 'text-ok bg-ok/15',
    violet: 'text-violet bg-violet/15',
  };
  return (
    <div className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${accentClass[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        {delta ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
            {delta}
          </span>
        ) : null}
      </div>
      <p className="mt-4 font-condensed text-3xl font-extrabold leading-none">{value}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-text-muted">
        {label}
      </p>
    </div>
  );
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const session = await requireUser();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Operations Overview
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {today} · {session.tenant.name}
          </p>
        </div>
        {!session.user.emailVerifiedAt ? (
          <a
            href="/verify-email-pending"
            className="rounded-[10px] border border-orange/30 bg-orange/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-light hover:bg-orange/20"
          >
            Confirm your email →
          </a>
        ) : null}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active Calls" value="0" delta="—" icon={Truck} tone="orange" />
        <KpiCard label="Drivers On Duty" value="0" delta="—" icon={Users} tone="blue" />
        <KpiCard label="Today's Revenue" value="$0" delta="—" icon={Wallet} tone="green" />
        <KpiCard label="Avg ETA" value="— min" delta="—" icon={Clock} tone="violet" />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-[14px] border border-steel-border bg-steel-mid p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
              Recent Activity
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Live feed
            </span>
          </div>
          <div className="mt-6 flex h-44 flex-col items-center justify-center rounded-[10px] border border-dashed border-steel-border bg-steel-light/20 text-center">
            <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
              Your first job will show here.
            </p>
            <p className="mt-1 max-w-md text-sm text-text-secondary">
              Welcome aboard — once dispatch starts assigning calls, this feed lights up in real
              time.
            </p>
          </div>
        </div>

        <div className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
          <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide">
            Quick Actions
          </h3>
          <p className="mt-1 text-xs text-text-secondary">Get the day moving.</p>
          <ul className="mt-5 space-y-3">
            <li>
              <Button variant="default" className="w-full justify-between" disabled>
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New call
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </li>
            <li>
              <Button variant="secondary" className="w-full justify-between" disabled>
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Add driver
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </li>
            <li>
              <Button variant="secondary" className="w-full justify-between" disabled>
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add customer
                </span>
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </li>
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            More actions unlock as integrations connect.
          </p>
        </div>
      </section>
    </div>
  );
}
