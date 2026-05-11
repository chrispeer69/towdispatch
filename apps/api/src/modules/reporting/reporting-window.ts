/**
 * Window resolver — turns the user-supplied `from`/`to`/`comparison` into
 * concrete UTC ranges. Shared across every report so the math is identical.
 */
import type { CommonReportFilters, ReportComparison } from '@towcommand/shared';

export interface ResolvedWindow {
  from: Date;
  to: Date;
  /** Window for the prior-period overlay; null when comparison='none'. */
  priorFrom: Date | null;
  priorTo: Date | null;
  /** Computed display label (e.g. 'May 2026'). */
  label: string;
}

export function resolveWindow(filters: CommonReportFilters, now: Date = new Date()): ResolvedWindow {
  const to = filters.to ? new Date(filters.to) : now;
  let from: Date;
  if (filters.from) {
    from = new Date(filters.from);
  } else {
    // Default: current calendar month (UTC).
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error('report window: from must be before to');
  }

  const { priorFrom, priorTo } = computePrior(from, to, filters.comparison);
  return {
    from,
    to,
    priorFrom,
    priorTo,
    label: formatLabel(from, to),
  };
}

function computePrior(
  from: Date,
  to: Date,
  comparison: ReportComparison,
): { priorFrom: Date | null; priorTo: Date | null } {
  if (comparison === 'none') return { priorFrom: null, priorTo: null };
  const span = to.getTime() - from.getTime();
  if (comparison === 'prior_period') {
    return {
      priorFrom: new Date(from.getTime() - span),
      priorTo: new Date(from.getTime()),
    };
  }
  // prior_year: shift exactly 1 year back from both edges.
  const priorFrom = new Date(from);
  priorFrom.setUTCFullYear(priorFrom.getUTCFullYear() - 1);
  const priorTo = new Date(to);
  priorTo.setUTCFullYear(priorTo.getUTCFullYear() - 1);
  return { priorFrom, priorTo };
}

function formatLabel(from: Date, to: Date): string {
  const f = from.toISOString().slice(0, 10);
  const t = to.toISOString().slice(0, 10);
  return `${f} → ${t}`;
}

/**
 * Bucket a date into the granularity key the report uses for time-series.
 */
export function bucketKey(d: Date, granularity: 'day' | 'week' | 'month'): string {
  const iso = d.toISOString();
  if (granularity === 'day') return iso.slice(0, 10);
  if (granularity === 'month') return iso.slice(0, 7);
  // week — ISO year-week (rough but stable).
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((tmp.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
