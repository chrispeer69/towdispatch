/**
 * /reports/saved — list of saved report configurations and any attached
 * schedules. Each row links back to its detail page (with the saved filters
 * pre-applied via URL params) and exposes a delete button.
 */
import { ApiError } from '@/lib/api/client';
import { fetchSavedReports } from '@/lib/api/reporting';
import { requireUser } from '@/lib/auth/session';
import { type ReportId, type SavedReportDto, reportTitles } from '@towcommand/shared';
import Link from 'next/link';
import { DeleteSavedButton } from './delete-saved-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Saved reports — TowCommand' };

export default async function SavedReportsPage(): Promise<JSX.Element> {
  await requireUser();
  let rows: SavedReportDto[] = [];
  try {
    rows = (await fetchSavedReports()).data;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Saved reports
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Reusable filter sets — schedule any to email on a cadence.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light"
        >
          ← All reports
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-steel-border p-8 text-center text-sm text-text-muted">
          No saved reports yet. Open any report and click <strong>Save &amp; schedule</strong>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-steel-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-steel-mid">
              <tr>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Name
                </th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Report
                </th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Schedule
                </th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Next run
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-steel-border/40 hover:bg-steel-mid/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/reports/${r.reportId}?${filtersToQuery(r.filters)}`}
                      className="text-text-primary hover:text-orange-light"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {reportTitles[r.reportId as ReportId]}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {r.schedule
                      ? `${r.schedule.cadence} → ${r.schedule.format.toUpperCase()} → ${r.schedule.recipients.length} recipient${r.schedule.recipients.length === 1 ? '' : 's'}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {r.schedule?.nextRunAt ? new Date(r.schedule.nextRunAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeleteSavedButton id={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function filtersToQuery(filters: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}
