/**
 * Pure A/R aging math (Session 53). Kept separate from the service so the
 * day-count and bucket edges (DST, leap years, weekends, exact boundaries)
 * are unit-testable without a DB.
 *
 * Age is whole days between the due date and the as-of instant, computed from
 * UTC milliseconds so a DST transition in the presentation timezone never
 * shifts the count. A not-yet-due invoice (negative age) is "current".
 */
const DAY_MS = 86_400_000;

export type AgingBucket = 'current' | 'b1' | 'b2' | 'b3plus';

/** Whole days from `due` to `asOf` (floored). Negative when not yet due. */
export function ageInDays(due: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - due.getTime()) / DAY_MS);
}

/**
 * Bucket an age against three ascending day thresholds [b1, b2, b3].
 *   age < b1            → current
 *   b1 <= age < b2      → b1
 *   b2 <= age < b3      → b2
 *   age >= b3           → b3plus
 */
export function bucketOf(ageDays: number, bucketDays: [number, number, number]): AgingBucket {
  const [b1, b2, b3] = bucketDays;
  if (ageDays < b1) return 'current';
  if (ageDays < b2) return 'b1';
  if (ageDays < b3) return 'b2';
  return 'b3plus';
}

/** Normalize a caller-supplied bucket list to exactly three ascending ints. */
export function normalizeBuckets(input: number[] | undefined): [number, number, number] {
  const def: [number, number, number] = [30, 60, 90];
  if (!input || input.length === 0) return def;
  const cleaned = input
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.floor(n))
    .sort((a, b) => a - b);
  return [cleaned[0] ?? def[0], cleaned[1] ?? def[1], cleaned[2] ?? def[2]];
}
