/**
 * Reports index — Session 14.
 *
 * Eight cards, one per report category. Each card fetches its own /summary
 * KPI tile in parallel; failures degrade to "—" rather than blocking the
 * whole page.
 */
import { Stat } from '@/components/reports/stat';
import { ApiError, apiServer } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import { REPORT_IDS, type ReportId, type ReportSummary } from '@towcommand/shared';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Reports — TowCommand' };
export const dynamic = 'force-dynamic';

interface ReportCardConfig {
  id: ReportId;
  title: string;
  blurb: string;
  accent: string;
}

const CARDS: ReportCardConfig[] = [
  {
    id: REPORT_IDS.DISPATCH,
    title: 'Dispatch performance',
    blurb: 'Jobs, GOA rate, call-to-dispatch time, on-scene time.',
    accent: '#F05A1A',
  },
  {
    id: REPORT_IDS.DRIVER,
    title: 'Driver performance',
    blurb: 'Jobs/day, on-time arrival, customer rating, GOA rate.',
    accent: '#FAB005',
  },
  {
    id: REPORT_IDS.REVENUE,
    title: 'Revenue',
    blurb: 'By service, source, account, motor club, ZIP, time.',
    accent: '#37B24D',
  },
  {
    id: REPORT_IDS.STORAGE,
    title: 'Storage & impound',
    blurb: 'Vehicles in yard, days, projected lien, A/R aging.',
    accent: '#1C7ED6',
  },
  {
    id: REPORT_IDS.PNL,
    title: 'Profit & loss',
    blurb: 'Revenue minus commission, fuel, depreciation, fees.',
    accent: '#7048E8',
  },
  {
    id: REPORT_IDS.COMMISSION,
    title: 'Commission',
    blurb: 'By driver, pay period, audit trail per job.',
    accent: '#D6336C',
  },
  {
    id: REPORT_IDS.TAX,
    title: 'Tax',
    blurb: 'Sales tax by jurisdiction. Export for filings.',
    accent: '#0CA678',
  },
  {
    id: REPORT_IDS.COMPLIANCE,
    title: 'Compliance',
    blurb: 'HOS exposure, expiring credentials, missing COIs.',
    accent: '#FA5252',
  },
];

async function loadSummary(reportId: ReportId): Promise<ReportSummary | null> {
  try {
    return await apiServer<ReportSummary>(`/reporting/${reportId}/summary`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
    if (err instanceof ApiError && err.status >= 500) return null;
    return null;
  }
}

export default async function ReportsIndexPage(): Promise<JSX.Element> {
  await requireUser();
  const summaries = await Promise.all(CARDS.map((c) => loadSummary(c.id)));

  return (
    <div className="space-y-6" data-testid="reports-index">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Reports
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Operational, financial, and compliance reporting.
          </p>
        </div>
        <Link
          href="/reports/saved"
          className="rounded-md border border-steel-border bg-steel-mid/60 px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
        >
          Saved reports →
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card, idx) => {
          const summary = summaries[idx];
          return (
            <Link
              key={card.id}
              href={`/reports/${card.id}`}
              className="group rounded-[14px] border border-steel-border bg-steel-mid/40 p-5 transition-colors hover:border-orange/60"
              data-testid={`report-card-${card.id}`}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: card.accent }}
                />
                <h2 className="font-condensed text-lg font-bold uppercase tracking-wide">
                  {card.title}
                </h2>
              </div>
              <p className="mt-1 text-xs text-text-secondary">{card.blurb}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {summary ? (
                  summary.kpis.slice(0, 4).map((k) => (
                    <Stat key={k.label} label={k.label} value={k.value} trend={k.trend ?? null} />
                  ))
                ) : (
                  <p className="col-span-2 text-xs text-text-muted">
                    No data — open report for details.
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
