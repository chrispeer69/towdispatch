/**
 * Pure repo-case math. No I/O, no Nest, no DB — deterministic and unit-tested
 * directly. RepoCaseService is thin orchestration over these helpers.
 */
import type { RepoCaseStatus } from '@ustowdispatch/shared';

/**
 * Post-recovery redemption window: the debtor's statutory period to cure the
 * default and reclaim the vehicle. `days` calendar days after `recoveredAt`.
 *
 * Computed in UTC (the DB stores UTC; presentation localizes). UTC has no DST,
 * so advancing whole days with setUTCDate is exact across DST boundaries,
 * month ends, and leap days — a Feb-29 recovery + 30 days lands on Mar-30, and
 * a window spanning a spring-forward boundary is still exactly N×24h later.
 * `days` is floored and clamped at 0 (a 0-day window ends at the recovery
 * instant). Per-state default windows are an S50/S51 concern; here the caller
 * passes the window it wants recorded.
 */
export function computeRedemptionEnd(recoveredAt: Date, days: number): Date {
  const safeDays = Math.max(0, Math.floor(days));
  const end = new Date(recoveredAt.getTime());
  end.setUTCDate(end.getUTCDate() + safeDays);
  return end;
}

/**
 * Repo case status machine. Allowed transitions (enforced in the service):
 *   open       -> located | recovered | surrendered | cancelled
 *   located    -> recovered | surrendered | cancelled
 *   recovered  -> closed
 *   surrendered-> closed
 *   closed     -> (terminal)
 *   cancelled  -> (terminal)
 * 'recovered'/'surrendered' are reached via recordRecovery (recovery_type
 * peaceful|voluntary_surrender ⇒ recovered, the service maps surrender), not
 * by a free-form status PATCH.
 */
const ALLOWED_TRANSITIONS: Record<RepoCaseStatus, readonly RepoCaseStatus[]> = {
  open: ['located', 'recovered', 'surrendered', 'cancelled'],
  located: ['recovered', 'surrendered', 'cancelled'],
  recovered: ['closed'],
  surrendered: ['closed'],
  closed: [],
  cancelled: [],
};

export function canTransition(from: RepoCaseStatus, to: RepoCaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses from which a field attempt may still be recorded. */
export const ATTEMPTABLE_STATUSES: readonly RepoCaseStatus[] = ['open', 'located'];

/** Statuses from which a recovery may be recorded. */
export const RECOVERABLE_STATUSES: readonly RepoCaseStatus[] = ['open', 'located'];

export function isAttemptable(status: RepoCaseStatus): boolean {
  return ATTEMPTABLE_STATUSES.includes(status);
}

export function isRecoverable(status: RepoCaseStatus): boolean {
  return RECOVERABLE_STATUSES.includes(status);
}
