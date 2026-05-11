/**
 * Resolve filter windows for every report.
 *
 * Inputs are open-ended ISO strings from the wire; outputs are concrete UTC
 * Date bounds the rest of the module can use without re-checking. Defaults
 * to the trailing 30 days when neither bound is provided so every report
 * has a sensible "open it cold" view.
 *
 * The comparison window is derived as the same span ending the day before
 * fromDate. For comparison='prior_year' we shift back 365 days. comparison='none'
 * leaves the comparison fields null.
 */
import type { ReportComparison, ReportFiltersBase } from '@ustowdispatch/shared';
import type { ResolvedReportWindow } from './reporting.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

export function resolveWindow(filters: Partial<ReportFiltersBase>): ResolvedReportWindow {
  const toDate = filters.toDate ? new Date(filters.toDate) : new Date();
  const fromDate = filters.fromDate
    ? new Date(filters.fromDate)
    : new Date(toDate.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  const comparison: ReportComparison = filters.comparison ?? 'none';
  let comparisonFromDate: Date | null = null;
  let comparisonToDate: Date | null = null;
  if (comparison === 'prior_period') {
    const span = toDate.getTime() - fromDate.getTime();
    comparisonToDate = new Date(fromDate.getTime() - 1);
    comparisonFromDate = new Date(comparisonToDate.getTime() - span);
  } else if (comparison === 'prior_year') {
    comparisonFromDate = new Date(fromDate.getTime() - 365 * DAY_MS);
    comparisonToDate = new Date(toDate.getTime() - 365 * DAY_MS);
  }
  return { fromDate, toDate, comparison, comparisonFromDate, comparisonToDate };
}

/** Compose a stable cache key from a filter blob. Used by the cache layer. */
export function filterHash(input: unknown): string {
  const stable = stableStringify(input);
  let hash = 0;
  for (let i = 0; i < stable.length; i++) {
    hash = (hash * 31 + stable.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
