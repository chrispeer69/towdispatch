/**
 * /fraud/reports — dispute reports. Server-rendered aggregate table: per
 * motor club, the win rate, average resolution time, and recovered dollars
 * over a 90-day window. Minimal v1 (no charts). Same RBAC as the rest of
 * fraud detection.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DisputeStatsDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { formatCents, formatWinRate } from '../fraud-ui-helpers';

export const metadata = { title: 'Dispute Reports — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function FraudReportsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<DisputeStatsDto>('/fraud-detection/reports/dispute-stats?days=90', {
      accessToken: token ?? null,
    }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Dispute Reports</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to fraud detection.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  const stats = result.data;
  const clubs = stats?.clubs ?? [];

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dispute Reports</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Win rate by motor club + recovered dollars over the last {stats?.windowDays ?? 90} days.
          </p>
        </div>
        <Link href="/fraud/disputes" className="text-accent-orange text-sm whitespace-nowrap">
          ← Dispute log
        </Link>
      </header>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Motor club</th>
              <th className="text-right px-4 py-2.5">Disputes</th>
              <th className="text-right px-4 py-2.5">Won</th>
              <th className="text-right px-4 py-2.5">Lost</th>
              <th className="text-right px-4 py-2.5">Open</th>
              <th className="text-right px-4 py-2.5">Win rate</th>
              <th className="text-right px-4 py-2.5">Avg days</th>
              <th className="text-right px-4 py-2.5">Disputed</th>
              <th className="text-right px-4 py-2.5">Recovered</th>
            </tr>
          </thead>
          <tbody>
            {clubs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No disputes logged in this window yet.
                </td>
              </tr>
            )}
            {clubs.map((c) => (
              <tr key={c.motorClubName} className="border-t border-border-on-dark">
                <td className="px-4 py-2.5 font-semibold">{c.motorClubName}</td>
                <td className="px-4 py-2.5 text-right">{c.total}</td>
                <td className="px-4 py-2.5 text-right text-status-success-on-dark">{c.won}</td>
                <td className="px-4 py-2.5 text-right text-status-warning">{c.lost}</td>
                <td className="px-4 py-2.5 text-right text-text-secondary-on-dark">{c.open}</td>
                <td className="px-4 py-2.5 text-right font-semibold">
                  {formatWinRate(c.winRatePct)}
                </td>
                <td className="px-4 py-2.5 text-right text-text-secondary-on-dark">
                  {c.avgResolutionDays ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right">{formatCents(c.amountDisputedCents)}</td>
                <td className="px-4 py-2.5 text-right text-status-success-on-dark">
                  {formatCents(c.recoveredCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
