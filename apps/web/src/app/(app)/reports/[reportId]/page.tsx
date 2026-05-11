/**
 * Generic report detail page. Routed by the `reportId` segment; the client
 * component understands the row shape for every report id.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import { REPORT_ID_VALUES, type ReportId, type ReportPage, type ReportSummary } from '@towcommand/shared';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { ReportDetailClient } from './report-detail-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}): Promise<{ title: string }> {
  const { reportId } = await params;
  return { title: `${reportId} — TowCommand reports` };
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}): Promise<JSX.Element> {
  await requireUser();
  const { reportId } = await params;
  if (!REPORT_ID_VALUES.includes(reportId as ReportId)) notFound();
  const typed = reportId as ReportId;

  // Best-effort: load initial summary + first page.
  let summary: ReportSummary | null = null;
  let firstPage: ReportPage<unknown> | null = null;
  try {
    const [s, p] = await Promise.all([
      apiServer<ReportSummary>(`/reporting/${typed}/summary`),
      apiServer<ReportPage<unknown>>(`/reporting/${typed}`),
    ]);
    summary = s;
    firstPage = p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="rounded-md border border-steel-border bg-steel-mid/40 p-6 text-sm text-text-secondary">
          You don't have access to this report.
        </div>
      );
    }
    // network / 5xx — render the page but in an error state.
  }

  return (
    <ReportDetailClient reportId={typed} initialSummary={summary} initialPage={firstPage} />
  );
}
