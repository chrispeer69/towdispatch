/**
 * Pure helpers for the Dynamic Pricing Engine. No DB, no DI — small,
 * deterministic functions used by `tier-resolution.service.ts` and the
 * cron services. Unit-tested in `dynamic-pricing-helpers.spec.ts`.
 */
import type {
  DynamicPricingCategory,
  DynamicPricingCurveData,
  DynamicPricingHolidayDateSpec,
  DynamicPricingHolidayOccurrence,
} from '@ustowdispatch/shared';

export interface TierForStack {
  tierId: string;
  name: string;
  category: DynamicPricingCategory;
  multiplier: number;
}

export interface StackingResult {
  /** The product of per-category-best multipliers, capped. */
  effectiveMultiplier: number;
  /** Tiers that contributed to the stack (one per category, the highest). */
  appliedTiers: TierForStack[];
  /** Tiers ignored due to category tie-break or below-1 multiplier. */
  suppressedTiers: TierForStack[];
  /** True if the cap reduced the raw stack. */
  capped: boolean;
}

/**
 * Stacking rule (locked spec):
 *  - Multiple tiers in DIFFERENT categories all stack multiplicatively.
 *  - Multiple tiers in the SAME category: the highest multiplier wins,
 *    others are suppressed.
 *  - The product is bounded by min(product, cap). cap default 3.0.
 */
export function stackTiers(tiers: TierForStack[], cap: number): StackingResult {
  if (cap <= 0) throw new Error('stackTiers: cap must be > 0');
  // Group by category and pick the max-multiplier per category.
  const byCategory = new Map<DynamicPricingCategory, TierForStack>();
  const suppressed: TierForStack[] = [];
  for (const t of tiers) {
    const incumbent = byCategory.get(t.category);
    if (!incumbent || t.multiplier > incumbent.multiplier) {
      if (incumbent) suppressed.push(incumbent);
      byCategory.set(t.category, t);
    } else {
      suppressed.push(t);
    }
  }
  const applied = Array.from(byCategory.values());
  const rawProduct = applied.reduce((acc, t) => acc * t.multiplier, 1);
  const effective = Math.min(rawProduct, cap);
  return {
    effectiveMultiplier: effective,
    appliedTiers: applied,
    suppressedTiers: suppressed,
    capped: effective < rawProduct,
  };
}

/**
 * Apply the stacking result to a base price. Returns the final cents and
 * the per-tier contribution-cents breakdown (used to populate the quote
 * response). Distributes the cents-added proportionally to each tier's
 * marginal contribution.
 */
export function applyStackToBase(
  baseCents: number,
  stack: StackingResult,
): { finalCents: number; perTierContribution: Map<string, number> } {
  const finalRaw = Math.round(baseCents * stack.effectiveMultiplier);
  const finalCents = finalRaw < baseCents ? baseCents : finalRaw;
  const totalDelta = finalCents - baseCents;
  const perTier = new Map<string, number>();
  if (totalDelta <= 0 || stack.appliedTiers.length === 0) {
    for (const t of stack.appliedTiers) perTier.set(t.tierId, 0);
    return { finalCents, perTierContribution: perTier };
  }
  // Marginal contribution = (multiplier - 1). If a tier has multiplier 1.0
  // it contributes 0; tiers above 1.0 share the cents proportionally.
  const totalMarginal = stack.appliedTiers.reduce(
    (acc, t) => acc + Math.max(t.multiplier - 1, 0),
    0,
  );
  if (totalMarginal === 0) {
    for (const t of stack.appliedTiers) perTier.set(t.tierId, 0);
    return { finalCents, perTierContribution: perTier };
  }
  let allocated = 0;
  const sortedTiers = [...stack.appliedTiers];
  for (let i = 0; i < sortedTiers.length; i++) {
    const t = sortedTiers[i];
    if (!t) continue;
    const marg = Math.max(t.multiplier - 1, 0);
    const share =
      i === sortedTiers.length - 1
        ? totalDelta - allocated
        : Math.round(totalDelta * (marg / totalMarginal));
    perTier.set(t.tierId, share);
    allocated += share;
  }
  return { finalCents, perTierContribution: perTier };
}

/**
 * Resolve the curve multiplier for a given local time, given the curve
 * data and mode. Uses the local hour boundary (e.g. 22:00 uses index 22).
 *
 * `localHour` is 0..23, `localDow` is 0..6 (0=Sunday). Caller computes
 * these in tenant timezone via Intl.DateTimeFormat.
 */
export function resolveCurveMultiplier(
  curve: DynamicPricingCurveData,
  mode: '24_hour' | '7x24',
  localDow: number,
  localHour: number,
): number {
  if (mode === '24_hour') {
    const arr = curve as number[];
    if (!Array.isArray(arr) || arr.length !== 24) return 1.0;
    const v = arr[localHour];
    return typeof v === 'number' && v > 0 ? v : 1.0;
  }
  const grid = curve as number[][];
  if (!Array.isArray(grid) || grid.length !== 7) return 1.0;
  const row = grid[localDow];
  if (!row || row.length !== 24) return 1.0;
  const v = row[localHour];
  return typeof v === 'number' && v > 0 ? v : 1.0;
}

/**
 * Trailing 4-week same-hour-same-weekday baseline. Given a list of
 * historical job counts grouped by (week, dow, hour) for the same yard,
 * return the simple mean of the matching cells. If we have zero history,
 * caller should suggest nothing.
 */
export function trailingBaseline(matchingCellCounts: number[]): number | null {
  const usable = matchingCellCounts.filter((n) => Number.isFinite(n));
  if (usable.length === 0) return null;
  const total = usable.reduce((a, b) => a + b, 0);
  return total / usable.length;
}

/**
 * Pick the highest threshold the current count breaches. Returns the
 * matching threshold + multiplier, or null if below all thresholds.
 *
 * `thresholdsPct` and `multipliers` arrays MUST be the same length and
 * sorted ascending (e.g. [150,200,300] / [1.3,1.6,2.0]).
 */
export function pickDemandSurgeTier(
  current: number,
  baseline: number,
  thresholdsPct: number[],
  multipliers: number[],
): { thresholdPct: number; multiplier: number } | null {
  if (baseline <= 0) return null;
  const ratioPct = (current / baseline) * 100;
  let best: { thresholdPct: number; multiplier: number } | null = null;
  for (let i = 0; i < thresholdsPct.length; i++) {
    const thr = thresholdsPct[i];
    const mult = multipliers[i];
    if (typeof thr !== 'number' || typeof mult !== 'number') continue;
    if (ratioPct >= thr) best = { thresholdPct: thr, multiplier: mult };
  }
  return best;
}

/**
 * Resolve a holiday's calendar date for a given year. Returns null if the
 * spec is malformed or the resolved day-of-month is invalid.
 */
export function resolveHolidayDate(
  occurrence: DynamicPricingHolidayOccurrence,
  spec: DynamicPricingHolidayDateSpec,
  year: number,
): Date | null {
  if (occurrence === 'fixed_date') {
    const s = spec as { month: number; day: number };
    if (!('day' in s)) return null;
    const dt = new Date(Date.UTC(year, s.month - 1, s.day));
    if (dt.getUTCMonth() !== s.month - 1 || dt.getUTCDate() !== s.day) return null;
    return dt;
  }
  // nth_weekday
  const n = spec as { month: number; weekday: number; ordinal: number };
  if (!('weekday' in n) || !('ordinal' in n)) return null;
  if (n.ordinal === 0) return null;
  if (n.ordinal === -1) {
    // last weekday of the month
    const firstNextMonth = new Date(Date.UTC(year, n.month, 1));
    firstNextMonth.setUTCDate(0); // last day of target month
    const lastDow = firstNextMonth.getUTCDay();
    const offset = (lastDow - n.weekday + 7) % 7;
    const day = firstNextMonth.getUTCDate() - offset;
    return new Date(Date.UTC(year, n.month - 1, day));
  }
  const first = new Date(Date.UTC(year, n.month - 1, 1));
  const firstDow = first.getUTCDay();
  const offset = (n.weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n.ordinal - 1) * 7;
  // Validate the day belongs to the month
  const dt = new Date(Date.UTC(year, n.month - 1, day));
  if (dt.getUTCMonth() !== n.month - 1) return null;
  return dt;
}

/** Tenant-local "YYYY-MM-DD" for the given Date, using the IANA tz string. */
export function localDateKey(when: Date, ianaTz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD format directly.
  return fmt.format(when);
}

/** Tenant-local hour 0..23 for the given Date, using the IANA tz string. */
export function localHour(when: Date, ianaTz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    hour: '2-digit',
    hour12: false,
  });
  const v = Number.parseInt(fmt.format(when), 10);
  return Number.isFinite(v) ? v % 24 : 0;
}

/**
 * Tenant-local day-of-week 0..6 (0=Sun) for the given Date.
 *
 * Intl.DateTimeFormat's "weekday: short" returns localized strings; using
 * formatToParts with timeZone-aware year/month/day and reconstructing the
 * Date is the deterministic path.
 */
export function localDow(when: Date, ianaTz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(when);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? 0);
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
