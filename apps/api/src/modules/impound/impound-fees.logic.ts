/**
 * Pure fee / lien math for the impound module. No I/O, no Nest, no DB —
 * everything here is deterministic and unit-tested directly. The service
 * and the accrual cron are thin orchestration over these functions.
 *
 * Billing convention (US towing industry standard): storage is charged
 * per CALENDAR DAY in UTC, arrival day inclusive, a partial day counts as
 * a full day. The clock starts at storage_started_at and runs while the
 * record status is 'stored' or 'pending_release'.
 */
import type { ImpoundRecordStatus } from '@ustowdispatch/shared';

/** Statuses whose storage clock is still running. */
export const ACCRUING_STATUSES: readonly ImpoundRecordStatus[] = ['stored', 'pending_release'];

/**
 * Days a vehicle must sit before it becomes lien-eligible. State law
 * varies (typically 21–45 days); 30 is a safe default. Session 23 wires
 * per-state overrides off the yard's `state` column.
 */
export const LIEN_ELIGIBLE_AFTER_DAYS = 30;

/**
 * Safety cap on a single accrual run's backfill. A record whose
 * last_accrued_on somehow drifted years into the past will catch up in
 * 10-year chunks across successive runs rather than building a
 * multi-thousand-element array in one tick.
 */
export const MAX_BACKFILL_DAYS = 3660;

export function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addUtcDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole-day difference `b - a`, both YYYY-MM-DD UTC date strings. */
export function diffUtcDays(aStr: string, bStr: string): number {
  const a = Date.parse(`${aStr}T00:00:00.000Z`);
  const b = Date.parse(`${bStr}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export interface AccrualInput {
  storageStartedAt: Date;
  lastAccruedOn: string | null;
  dailyFeeCents: number;
  status: ImpoundRecordStatus;
}

export interface AccrualPlan {
  /** YYYY-MM-DD days that need a daily_storage fee written. */
  daysToAccrue: string[];
  /** dailyFeeCents × daysToAccrue.length. */
  totalCents: number;
  /** The value last_accrued_on should be set to (unchanged if no days). */
  newLastAccruedOn: string | null;
}

/**
 * Decide which calendar days a record owes a daily storage fee for, as of
 * `today`. Idempotent by construction: the next run starts the day after
 * `newLastAccruedOn`, so re-running with the same `today` yields no days.
 *
 * - Non-accruing status (released/transferred/disposed): nothing.
 * - dailyFeeCents <= 0: nothing, and last_accrued_on is NOT advanced so a
 *   later non-zero fee still backfills the stored days.
 * - Otherwise: every day from (last_accrued_on + 1, or the storage start
 *   date when never accrued) through today, inclusive.
 */
export function planDailyAccrual(input: AccrualInput, today: Date): AccrualPlan {
  const unchanged: AccrualPlan = {
    daysToAccrue: [],
    totalCents: 0,
    newLastAccruedOn: input.lastAccruedOn,
  };
  if (!ACCRUING_STATUSES.includes(input.status)) return unchanged;
  if (input.dailyFeeCents <= 0) return unchanged;

  const todayStr = toUtcDateString(today);
  const startStr = input.lastAccruedOn
    ? addUtcDays(input.lastAccruedOn, 1)
    : toUtcDateString(input.storageStartedAt);

  if (diffUtcDays(startStr, todayStr) < 0) return unchanged;

  const days: string[] = [];
  let cursor = startStr;
  let guard = 0;
  while (diffUtcDays(cursor, todayStr) >= 0 && guard < MAX_BACKFILL_DAYS) {
    days.push(cursor);
    cursor = addUtcDays(cursor, 1);
    guard += 1;
  }
  if (days.length === 0) return unchanged;

  const lastDay = days[days.length - 1];
  return {
    daysToAccrue: days,
    totalCents: days.length * input.dailyFeeCents,
    newLastAccruedOn: lastDay ?? input.lastAccruedOn,
  };
}

export interface LienEligibility {
  eligible: boolean;
  daysStored: number;
}

/** Days stored (UTC calendar) and whether that crosses the lien threshold. */
export function computeLienEligibility(storageStartedAt: Date, today: Date): LienEligibility {
  const daysStored = Math.max(
    0,
    diffUtcDays(toUtcDateString(storageStartedAt), toUtcDateString(today)),
  );
  return { eligible: daysStored >= LIEN_ELIGIBLE_AFTER_DAYS, daysStored };
}

/** Sum of non-soft-deleted fee amounts. */
export function sumFeeCents(fees: { amountCents: number; deletedAt: Date | null }[]): number {
  return fees.reduce((acc, f) => (f.deletedAt ? acc : acc + f.amountCents), 0);
}
