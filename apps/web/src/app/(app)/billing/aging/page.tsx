import { fetchAging, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { AgingResponse } from '@towdispatch/shared';
import { AlertTriangle, Lock } from 'lucide-react';

export const metadata = { title: 'A/R aging — Tow Dispatch' };
export const dynamic = 'force-dynamic';

const EMPTY_TOTALS: AgingResponse['totals'] = {
  currentDueCents: 0,
  bucket1To30Cents: 0,
  bucket31To60Cents: 0,
  bucket61To90Cents: 0,
  bucket91PlusCents: 0,
  totalCents: 0,
  invoiceCount: 0,
};

export default async function AgingPage(): Promise<JSX.Element> {
  // Session 9.8 — read cookies at the page level (where Next.js 15
  // guarantees the AsyncLocalStorage request scope) and pass the token
  // explicitly through the fetcher. Without this the cookie scope is
  // lost across the typed-fetcher module hop in production builds.
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchAging({}, token));

  // Three render states: error, empty (no data), populated. The previous
  // version silently swallowed any 4xx into all-zeros tiles, which made
  // permission failures, real empties, and stale-token bounces all look
  // identical (and identically "broken") to the operator. Surface each
  // case explicitly so the page tells you what's going on.
  const error = result.error;
  const aging = result.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          A/R aging
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          {aging
            ? `As of ${aging.asOf.slice(0, 10)}`
            : 'Outstanding balance by account, bucketed by days past due.'}
        </p>
      </header>

      {error ? <ErrorBanner status={error.status} message={error.message} /> : null}

      <div className="grid gap-2 md:grid-cols-6">
        <Tile
          label="Current"
          value={aging?.totals.currentDueCents ?? EMPTY_TOTALS.currentDueCents}
        />
        <Tile
          label="1-30 days"
          value={aging?.totals.bucket1To30Cents ?? EMPTY_TOTALS.bucket1To30Cents}
        />
        <Tile
          label="31-60 days"
          value={aging?.totals.bucket31To60Cents ?? EMPTY_TOTALS.bucket31To60Cents}
        />
        <Tile
          label="61-90 days"
          value={aging?.totals.bucket61To90Cents ?? EMPTY_TOTALS.bucket61To90Cents}
        />
        <Tile
          label="91+ days"
          value={aging?.totals.bucket91PlusCents ?? EMPTY_TOTALS.bucket91PlusCents}
        />
        <Tile label="Total due" value={aging?.totals.totalCents ?? EMPTY_TOTALS.totalCents} bold />
      </div>

      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm" data-testid="aging-table">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Account / Customer</Th>
              <Th align="right">Current</Th>
              <Th align="right">1-30</Th>
              <Th align="right">31-60</Th>
              <Th align="right">61-90</Th>
              <Th align="right">91+</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {aging?.rows.map((r) => (
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
            {!error && aging && aging.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-text-secondary-on-dark"
                >
                  <p className="font-semibold text-text-primary-on-dark">No outstanding balances</p>
                  <p className="mt-1 text-text-secondary-on-dark">
                    A row appears here once an invoice is issued and its balance is greater than
                    zero. Only invoices in <code className="font-mono">issued</code>,{' '}
                    <code className="font-mono">sent</code>,{' '}
                    <code className="font-mono">partially_paid</code>, or{' '}
                    <code className="font-mono">overdue</code> status are aged — drafts and paid
                    invoices are excluded.
                  </p>
                </td>
              </tr>
            ) : null}
            {error ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-text-secondary-on-dark"
                >
                  Couldn&rsquo;t load aging data — see the banner above for details.
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
      <p className="text-xs uppercase tracking-wider text-text-secondary-on-dark">{label}</p>
      <p className={`mt-1 font-mono text-lg ${bold ? 'font-bold' : ''}`}>
        {formatMoneyCents(value)}
      </p>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}): JSX.Element {
  return (
    <th
      className={`px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function ErrorBanner({ status, message }: { status: number; message: string }): JSX.Element {
  const isPermission = status === 401 || status === 403;
  const Icon = isPermission ? Lock : AlertTriangle;
  const title = isPermission
    ? 'You don’t have permission to view A/R aging'
    : `Couldn’t load A/R aging (HTTP ${status})`;
  const body = isPermission
    ? 'A/R aging is gated to Owner, Admin, Manager, and Accounting roles. Ask an admin to switch your role or grant access.'
    : message;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
      <div>
        <p className="font-semibold text-text-primary-on-dark">{title}</p>
        <p className="mt-1 text-text-secondary-on-dark">{body}</p>
      </div>
    </div>
  );
}
