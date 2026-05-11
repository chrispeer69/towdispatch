/**
 * /reports — Session 14 reports index.
 *
 * Eight cards, one per report category. Each card shows top-line KPI summary
 * for the current month. Cards the caller's role can't open are dimmed and
 * non-navigable.
 */
import { ApiError } from '@/lib/api/client';
import { fetchReportIndex, fetchReportSummary } from '@/lib/api/reporting';
import { requireUser } from '@/lib/auth/session';
import type { KpiTile, ReportId, ReportSummaryDto } from '@towcommand/shared';
import Link from 'next/link';

export const metadata = { title: 'Reports — TowCommand' };
export const dynamic = 'force-dynamic';

export default async function ReportsIndexPage(): Promise<JSX.Element> {
  await requireUser();
  const { reports } = await fetchReportIndex();
  // Fetch each summary in parallel for the allowed cards; show a "no access"
  // chip on the rest.
  const summaries = await Promise.all(
    reports.map(async (r): Promise<{ id: ReportId; summary: ReportSummaryDto | null }> => {
      if (!r.allowed) return { id: r.id, summary: null };
      try {
        return { id: r.id, summary: await fetchReportSummary(r.id) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          return { id: r.id, summary: null };
        }
        // Don't crash the index for one bad report — emit empty.
        return { id: r.id, summary: null };
      }
    }),
  );
  const byId = new Map(summaries.map((s) => [s.id, s.summary]));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Reports
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Operational and financial reports — current month rolling window.
          </p>
        </div>
        <Link
          href="/reports/saved"
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light"
        >
          Saved reports
        </Link>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        data-testid="report-grid"
      >
        {reports.map((r) => (
          <ReportCard
            key={r.id}
            id={r.id}
            title={r.title}
            description={r.description}
            allowed={r.allowed}
            summary={byId.get(r.id) ?? null}
          />
        ))}
      </section>
    </div>
  );
}

function ReportCard({
  id,
  title,
  description,
  allowed,
  summary,
}: {
  id: ReportId;
  title: string;
  description: string;
  allowed: boolean;
  summary: ReportSummaryDto | null;
}): JSX.Element {
  const cardClass = allowed
    ? 'block rounded-lg border border-steel-border bg-steel-mid/40 p-4 transition-colors hover:border-orange/60 hover:bg-steel-mid/70'
    : 'block rounded-lg border border-steel-border/60 bg-steel-mid/20 p-4 opacity-60';
  const content = (
    <>
      <header className="flex items-center justify-between">
        <h2 className="font-condensed text-lg font-bold uppercase tracking-wide">{title}</h2>
        {!allowed ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            No access
          </span>
        ) : null}
      </header>
      <p className="mt-1 text-xs text-text-secondary line-clamp-2">{description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(summary?.kpis ?? []).slice(0, 4).map((k: KpiTile) => (
          <div key={k.label} className="rounded-md bg-steel/50 p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">{k.label}</div>
            <div
              className={`mt-0.5 font-condensed text-base font-extrabold ${tone(k.tone ?? 'neutral')}`}
            >
              {k.value ?? '—'}
            </div>
          </div>
        ))}
        {summary === null && allowed ? (
          <div className="col-span-2 text-xs text-text-muted">No data yet for this period.</div>
        ) : null}
      </div>
    </>
  );
  if (!allowed) {
    return <div className={cardClass}>{content}</div>;
  }
  return (
    <Link href={`/reports/${id}`} className={cardClass}>
      {content}
    </Link>
  );
}

function tone(t: 'ok' | 'warn' | 'danger' | 'neutral'): string {
  switch (t) {
    case 'ok':
      return 'text-ok';
    case 'warn':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-text-primary';
  }
}
