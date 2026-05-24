import { BreakdownChart, TimeSeriesChart } from '@/components/reports/charts';
import { ReportDataTable } from '@/components/reports/data-table';
import { ExportButtons } from '@/components/reports/export-buttons';
import { FilterBar } from '@/components/reports/filter-bar';
import { KpiRow } from '@/components/reports/kpi-row';
import { SaveReportButton } from '@/components/reports/save-report-button';
/**
 * /reports/[reportId] — detail page for any one of the eight reports.
 *
 * Layout:
 *   [filter sidebar]  |  [KPI row]
 *                     |  [primary chart — time series]
 *                     |  [secondary breakdown chart]
 *                     |  [data table with sort + column toggle + export]
 *
 * Filters are URL-encoded so the page is server-renderable and bookmarkable.
 * Permission errors land us on the index with a 403 message.
 */
import { ApiError } from '@/lib/api/client';
import { fetchReportDetail } from '@/lib/api/reporting';
import { requireUser } from '@/lib/auth/session';
import {
  type ReportDetailDto,
  type ReportId,
  reportShortDescriptions,
  reportTitles,
} from '@ustowdispatch/shared';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const KNOWN_REPORTS: ReportId[] = [
  'dispatch-performance',
  'driver-performance',
  'revenue',
  'storage',
  'pnl',
  'commission',
  'tax',
  'compliance',
];

const DIMENSIONS: Record<ReportId, Array<{ key: string; label: string }>> = {
  'dispatch-performance': [{ key: 'dispatcherId', label: 'Dispatcher ID' }],
  'driver-performance': [{ key: 'driverId', label: 'Driver ID' }],
  revenue: [
    { key: 'source', label: 'Source' },
    { key: 'accountId', label: 'Account ID' },
    { key: 'zip', label: 'ZIP' },
  ],
  storage: [],
  pnl: [{ key: 'truckId', label: 'Truck ID' }],
  commission: [{ key: 'driverId', label: 'Driver ID' }],
  tax: [{ key: 'jurisdiction', label: 'Jurisdiction' }],
  compliance: [],
};

interface SearchParams {
  fromDate?: string;
  toDate?: string;
  comparison?: string;
  driverId?: string;
  truckId?: string;
  dispatcherId?: string;
  accountId?: string;
  source?: string;
  zip?: string;
  jurisdiction?: string;
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  await requireUser();
  const { reportId } = await params;
  const sp = await searchParams;
  if (!KNOWN_REPORTS.includes(reportId as ReportId)) notFound();
  const id = reportId as ReportId;
  const filters = normalizeFilters(sp);

  let detail: ReportDetailDto | null = null;
  let errorMessage: string | null = null;
  try {
    detail = await fetchReportDetail(id, filters);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      errorMessage = 'You do not have access to this report.';
    } else if (err instanceof ApiError) {
      errorMessage = err.message;
    } else {
      throw err;
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px,1fr]">
      <FilterBar
        dimensions={DIMENSIONS[id]}
        initial={
          Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === 'string')) as Record<
            string,
            string
          >
        }
      />
      <main className="space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
              Reports
            </p>
            <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
              {reportTitles[id]}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">{reportShortDescriptions[id]}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ExportButtons reportId={id} filters={asStringRecord(sp)} />
            <SaveReportButton reportId={id} filters={asStringRecord(sp)} />
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
            {errorMessage}
          </div>
        ) : null}

        {detail ? (
          <>
            <KpiRow kpis={detail.kpis} />
            <section className="rounded-lg border border-steel-border bg-steel-mid/40 p-4">
              <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-text-secondary">
                Trend
              </h2>
              <TimeSeriesChart data={detail.timeSeries} />
            </section>
            <section className="rounded-lg border border-steel-border bg-steel-mid/40 p-4">
              <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-text-secondary">
                Breakdown
              </h2>
              <BreakdownChart data={detail.breakdown} />
            </section>
            <section>
              <ReportDataTable rows={detail.rows} />
            </section>
            {detail.notes.length > 0 ? (
              <aside className="rounded-lg border border-steel-border/60 bg-steel-mid/30 p-3 text-xs text-text-secondary">
                <h3 className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Notes
                </h3>
                <ul className="list-disc pl-4 space-y-1">
                  {detail.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function normalizeFilters(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (sp.fromDate) out.fromDate = withTime(sp.fromDate, 'T00:00:00.000Z');
  if (sp.toDate) out.toDate = withTime(sp.toDate, 'T23:59:59.999Z');
  if (sp.comparison) out.comparison = sp.comparison;
  for (const k of [
    'driverId',
    'truckId',
    'dispatcherId',
    'accountId',
    'source',
    'zip',
    'jurisdiction',
  ] as const) {
    const v = sp[k];
    if (v) out[k] = v;
  }
  return out;
}

function withTime(d: string, suffix: string): string {
  if (d.includes('T')) return d;
  return `${d}${suffix}`;
}

function asStringRecord(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
