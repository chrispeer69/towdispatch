/**
 * Pure clock helpers for the report scheduler.
 *
 *   computeNextRun(cadence, lastRunOrNow) → next run timestamp at 08:00 local
 *   (UTC for now — tenant timezone is a future feature, called out in the
 *   docs/reporting.md decisions log).
 *
 *   daily   — next 08:00 UTC after the anchor.
 *   weekly  — next Monday 08:00 UTC after the anchor.
 *   monthly — first day of the next month, 08:00 UTC.
 */
import type { ReportScheduleCadence } from '@ustowdispatch/shared';

const RUN_HOUR_UTC = 8;

export function computeNextRun(cadence: ReportScheduleCadence, anchor: Date): Date {
  switch (cadence) {
    case 'daily':
      return nextDailyAt(anchor, RUN_HOUR_UTC);
    case 'weekly':
      return nextWeeklyAt(anchor, RUN_HOUR_UTC);
    case 'monthly':
      return nextMonthlyAt(anchor, RUN_HOUR_UTC);
  }
}

function nextDailyAt(anchor: Date, hourUtc: number): Date {
  const candidate = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (candidate.getTime() <= anchor.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

function nextWeeklyAt(anchor: Date, hourUtc: number): Date {
  // Monday = 1 in ECMAScript getUTCDay() (Sunday = 0).
  const base = nextDailyAt(anchor, hourUtc);
  const day = base.getUTCDay();
  const toMonday = (1 - day + 7) % 7;
  if (toMonday > 0) base.setUTCDate(base.getUTCDate() + toMonday);
  return base;
}

function nextMonthlyAt(anchor: Date, hourUtc: number): Date {
  const candidate = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1, hourUtc, 0, 0, 0),
  );
  return candidate;
}
