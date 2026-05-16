import { fetchAging, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { AgingResponse } from '@ustowdispatch/shared';

export const metadata = { title: 'A/R aging — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

function emptyAging(): AgingResponse {
  return {
    asOf: new Date().toISOString(),
    totals: {
      currentDueCents: 0,
      bucket1To30Cents: 0,
      bucket31To60Cents: 0,
      bucket61To90Cents: 0,
      bucket91PlusCents: 0,
      totalCents: 0,
      invoiceCount: 0,
    },
    rows: [],
  };
}

export default async function AgingPage(): Promise<JSX.Element> {
  // Session 9.8 — read cookies at the page level (where Next.js 15
  // guarantees the AsyncLocalStorage request scope) and pass the token
  // explicitly through the fetcher. Without this the cookie scope is
  // lost across the typed-fetcher module hop in production builds, the
  // API answers 401, and tryFetch swallows it into emptyAging — the
  // page rendered but showed permanent zeros.
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchAging({}, token));
  const aging = result.data ?? emptyAging();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          A/R aging
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">As of {aging.asOf.slice(0, 10)}</p>
      </header>
      <div className="grid gap-2 md:grid-cols-6">
        <Tile label="Current" value={aging.totals.currentDueCents} />
        <Tile label="1-30 days" value={aging.totals.bucket1To30Cents} />
        <Tile label="31-60 days" value={aging.totals.bucket31To60Cents} />
        <Tile label="61-90 days" value={aging.totals.bucket61To90Cents} />
        <Tile label="91+ days" value={aging.totals.bucket91PlusCents} />
        <Tile label="Total due" value={aging.totals.totalCents} bold />
      </div>
      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm" data-testid="aging-table">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Account / Customer
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Current
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                1-30
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                31-60
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                61-90
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                91+
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {aging.rows.map((r) => (
              <tr key={`${r.accountId ?? r.customerId ?? 'unk'}`}>
                <td className="px-4 py-2">{r.accountName ?? r.customerName ?? '—'}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(r.currentDueCents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(r.bucket1To30Cents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(r.bucket31To60Cents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(r.bucket61To90Cents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(r.bucket91PlusCents)}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold">
                  {formatMoneyCents(r.totalCents)}
                </td>
              </tr>
            ))}
            {aging.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-text-secondary-on-dark-on-dark/60"
                >
                  No outstanding balances.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: number;
  bold?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-divider p-3">
      <p className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg ${bold ? 'font-bold' : ''}`}>
        {formatMoneyCents(value)}
      </p>
    </div>
  );
}
