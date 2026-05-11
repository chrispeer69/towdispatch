/**
 * Saved reports + schedules — Session 14.
 *
 * Lists every saved report in the tenant and the schedules attached to
 * them. Both lists are read via the BFF.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import type { ReportScheduleDto, SavedReportDto } from '@towcommand/shared';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Saved reports — TowCommand' };
export const dynamic = 'force-dynamic';

interface SavedListResponse {
  rows: SavedReportDto[];
}

interface ScheduleListResponse {
  rows: ReportScheduleDto[];
}

export default async function SavedReportsPage(): Promise<JSX.Element> {
  await requireUser();
  let savedRows: SavedReportDto[] = [];
  let scheduleRows: ReportScheduleDto[] = [];
  try {
    const [saved, schedules] = await Promise.all([
      apiServer<SavedListResponse>('/reporting/saved'),
      apiServer<ScheduleListResponse>('/reporting/schedules'),
    ]);
    savedRows = saved.rows;
    scheduleRows = schedules.rows;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  const schedulesBySaved = new Map<string, ReportScheduleDto[]>();
  for (const s of scheduleRows) {
    const cur = schedulesBySaved.get(s.savedReportId) ?? [];
    cur.push(s);
    schedulesBySaved.set(s.savedReportId, cur);
  }

  return (
    <div className="space-y-6" data-testid="saved-reports-index">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Saved reports
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Saved configurations and their email schedules.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-steel-border bg-steel-mid/60 px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
        >
          ← Back to reports
        </Link>
      </header>

      {savedRows.length === 0 ? (
        <section className="rounded-md border border-steel-border bg-steel-mid/40 p-8 text-center text-sm text-text-secondary">
          No saved reports yet. Open any report and use <strong>Save & schedule</strong>.
        </section>
      ) : (
        <section className="overflow-hidden rounded-md border border-steel-border bg-steel-mid/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-secondary">
                <th className="border-b border-steel-border px-3 py-2">Name</th>
                <th className="border-b border-steel-border px-3 py-2">Report</th>
                <th className="border-b border-steel-border px-3 py-2">Created</th>
                <th className="border-b border-steel-border px-3 py-2">Schedules</th>
                <th className="border-b border-steel-border px-3 py-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {savedRows.map((r) => (
                <tr key={r.id} className="border-b border-steel-border/40">
                  <td className="px-3 py-2 font-semibold">{r.name}</td>
                  <td className="px-3 py-2 text-text-secondary">{r.reportId}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {(schedulesBySaved.get(r.id) ?? []).length === 0 ? (
                      <span className="text-text-muted">No schedule</span>
                    ) : (
                      (schedulesBySaved.get(r.id) ?? [])
                        .map((s) => `${s.cadence} @ ${s.hourUtc}:00Z (${s.format.toUpperCase()})`)
                        .join(', ')
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/reports/${r.reportId}?saved=${r.id}`}
                      className="text-orange-light hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
