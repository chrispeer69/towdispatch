/**
 * Reporting â€” Session 9 light tile.
 *
 * Single page for now; full reporting module is a future session. The
 * tracking summary is the only tile here. We keep the page so the link
 * is real and the URL is bookmarkable.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { JSX } from 'react';

export const metadata = { title: 'Reporting â€” US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface TrackingReport {
  smsSent: number;
  smsDelivered: number;
  smsFailed: number;
  smsSkipped: number;
  linksViewed: number;
  avgTimeToFirstViewSeconds: number | null;
  ratingsCount: number;
  avgRating: number | null;
}

export default async function ReportingPage(): Promise<JSX.Element> {
  // Auth is enforced by (app)/layout.tsx. tryFetch surfaces a per-feature
  // 401/403 as data so a missing-scope endpoint can't redirect this page out
  // from under the layout's already-authenticated shell.
  const result = await tryFetch(() => apiServer<TrackingReport>('/tracking/reporting/summary'));
  const report: TrackingReport | null = result.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          Reporting
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Customer tracking and SMS performance.
        </p>
      </header>

      <section
        className="rounded-[14px] border border-divider bg-bg-surface/40 p-6"
        data-testid="tracking-report-tile"
      >
        <h2 className="font-condensed text-xl font-bold uppercase tracking-wide mb-4">
          Customer tracking
        </h2>
        {report ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="SMS sent" value={report.smsSent} />
            <Stat label="Delivered" value={report.smsDelivered} />
            <Stat label="Failed" value={report.smsFailed} tone="err" />
            <Stat label="Skipped" value={report.smsSkipped} tone="muted" />
            <Stat label="Links viewed" value={report.linksViewed} />
            <Stat
              label="Avg time-to-view"
              value={
                report.avgTimeToFirstViewSeconds === null
                  ? 'â€”'
                  : formatSeconds(report.avgTimeToFirstViewSeconds)
              }
            />
            <Stat label="Ratings" value={report.ratingsCount} />
            <Stat
              label="Avg rating"
              value={report.avgRating === null ? 'â€”' : `${report.avgRating} â˜…`}
            />
          </div>
        ) : (
          <p className="text-text-secondary-on-dark text-sm">No tracking data yet.</p>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'err' | 'muted';
}): JSX.Element {
  const cls =
    tone === 'err'
      ? 'text-danger'
      : tone === 'muted'
        ? 'text-text-secondary-on-dark'
        : 'text-text-primary-on-dark';
  return (
    <div className="rounded-md bg-bg-base/50 p-3">
      <div className="text-xs uppercase tracking-wider text-text-secondary-on-dark">{label}</div>
      <div className={`mt-1 font-condensed text-2xl font-extrabold ${cls}`}>{value}</div>
    </div>
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
