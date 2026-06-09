/**
 * /active-calls — drill-down opened from the Active Calls tile on the
 * Operations Overview. Lists a grid of clickable client tiles (initials
 * monogram + count badge) so dispatch can see at a glance which contracted
 * client / motor club is generating the load. Each tile deep-links into
 * /active-calls/[accountId] for that client's filtered list.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Truck } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Active Calls — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface ActiveCallsAccountBucket {
  accountId: string;
  accountName: string;
  isMotorClub: boolean;
  count: number;
}

interface ActiveCallsBreakdownDto {
  total: number;
  byAccount: ActiveCallsAccountBucket[];
  noAccount: number;
}

function monogramOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase() || '?';
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
}

// Stable monogram color from the account name. A small palette keeps the
// grid visually scannable; same client → same color across refreshes.
const TILE_PALETTE = [
  'bg-brand-primary/15 text-brand-primary',
  'bg-info/15 text-info',
  'bg-ok/15 text-ok',
  'bg-violet/15 text-violet',
  'bg-warning/15 text-warning',
] as const;
function tileColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TILE_PALETTE[Math.abs(hash) % TILE_PALETTE.length] ?? TILE_PALETTE[0];
}

export default async function ActiveCallsIndexPage(): Promise<JSX.Element> {
  const res = await tryFetch(() =>
    apiServer<ActiveCallsBreakdownDto>('/dashboard/active-calls-breakdown'),
  );
  const data: ActiveCallsBreakdownDto = res.data ?? { total: 0, byAccount: [], noAccount: 0 };

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
              Active Calls
            </h1>
            <p className="mt-1 text-sm text-text-secondary-on-dark">
              <span className="font-condensed text-base font-extrabold text-text-primary-on-dark">
                {data.total}
              </span>{' '}
              total · split across {data.byAccount.length} client
              {data.byAccount.length === 1 ? '' : 's'}
              {data.noAccount ? ` + ${data.noAccount} cash/no-account` : ''}
            </p>
          </div>
          <Link
            href="/intake"
            className="rounded-[10px] border border-divider px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] hover:border-brand-primary/40 hover:text-brand-primary"
          >
            + New call
          </Link>
        </div>
      </header>

      {data.total === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-center">
          <Truck className="h-8 w-8 text-text-secondary-on-dark/40" />
          <p className="mt-2 font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            No active calls right now.
          </p>
          <p className="mt-1 max-w-md text-sm text-text-secondary-on-dark">
            Calls dispatched from intake will appear here, grouped by client.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {data.byAccount.map((b) => (
            <ClientTile
              key={b.accountId}
              href={`/active-calls/${b.accountId}`}
              name={b.accountName}
              subline={b.isMotorClub ? 'Motor club' : 'Commercial'}
              count={b.count}
            />
          ))}
          {data.noAccount > 0 ? (
            <ClientTile
              href="/active-calls/cash"
              name="Cash / No account"
              subline="Walk-up & retail"
              count={data.noAccount}
              monoOverride="$"
            />
          ) : null}
        </section>
      )}
    </div>
  );
}

function ClientTile({
  href,
  name,
  subline,
  count,
  monoOverride,
}: {
  href: string;
  name: string;
  subline: string;
  count: number;
  monoOverride?: string;
}): JSX.Element {
  const mono = monoOverride ?? monogramOf(name);
  const colorCls = tileColorFor(name);
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3 rounded-[14px] border border-divider bg-bg-surface p-4 transition-colors hover:border-brand-primary/40 hover:bg-bg-surface-elevated/20"
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full font-condensed text-xl font-extrabold uppercase',
            colorCls,
          )}
        >
          {mono}
        </div>
        <div className="rounded-full border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-brand-primary">
          {count}
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="line-clamp-2 font-condensed text-sm font-extrabold uppercase leading-tight tracking-wide">
          {name}
        </p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
          {subline}
        </p>
      </div>
      <ArrowUpRight className="absolute bottom-3 right-3 h-4 w-4 text-text-secondary-on-dark/40 transition-colors group-hover:text-brand-primary" />
    </Link>
  );
}
