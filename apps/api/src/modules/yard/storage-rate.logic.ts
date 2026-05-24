/**
 * Pure rate-card / vehicle-classification / storage-charge math for the yard
 * module (Session 54). No I/O — deterministic and unit-tested directly.
 *
 * Billing convention (mirrors S22 impound): storage is charged per CALENDAR
 * DAY in UTC, the storage-start day inclusive, a partial day counting as a
 * full day. free_days waives the first N calendar days; max_daily_rate_cents
 * caps a single day's charge.
 */
import type { StorageVehicleClass } from '@ustowdispatch/shared';

// ----------------------------------------------------------------------
// UTC calendar-day helpers (same convention as impound-fees.logic.ts)
// ----------------------------------------------------------------------

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

// ----------------------------------------------------------------------
// classifyVehicle
// ----------------------------------------------------------------------

export interface VehicleClassInput {
  /**
   * vehicles.vehicle_class dispatch enum when a vehicle is linked:
   * light_duty | medium_duty | heavy_duty | motorcycle | commercial | rv |
   * unknown. Null when the impound has no linked vehicle.
   */
  dispatchClass: string | null;
  /** vehicles.body_class free text (e.g. 'trailer', 'pickup', 'sedan'). */
  bodyClass: string | null;
  /** Gross vehicle weight rating in lbs (heavy-duty job attrs), if known. */
  gvwrLbs: number | null;
  /** Axle count, if known. */
  axleCount: number | null;
}

const includesAny = (hay: string | null, needles: string[]): boolean => {
  if (!hay) return false;
  const s = hay.toLowerCase();
  return needles.some((n) => s.includes(n));
};

/**
 * Map the best available signals to a storage vehicle_class. Decision order
 * (first match wins) — documented per branch in SESSION_54_DECISIONS.md:
 *   1. Explicit body categories that are unambiguous regardless of weight:
 *      motorcycle, trailer, rv/motorhome.
 *   2. Heavy by hard signal: GVWR ≥ 26001 lbs (US Class 7-8), or ≥ 3 axles,
 *      or dispatch class heavy_duty/commercial.
 *   3. Light truck: medium_duty, pickup/truck/van bodies, or GVWR 10001-26000.
 *   4. Passenger: light_duty / car bodies / everything else (safe default).
 */
export function classifyVehicle(input: VehicleClassInput): StorageVehicleClass {
  if (
    input.dispatchClass === 'motorcycle' ||
    includesAny(input.bodyClass, ['motorcycle', 'moped'])
  ) {
    return 'motorcycle';
  }
  if (includesAny(input.bodyClass, ['trailer'])) {
    return 'trailer';
  }
  if (
    input.dispatchClass === 'rv' ||
    includesAny(input.bodyClass, ['rv', 'motorhome', 'recreational'])
  ) {
    return 'rv';
  }
  if (
    (input.gvwrLbs !== null && input.gvwrLbs >= 26_001) ||
    (input.axleCount !== null && input.axleCount >= 3) ||
    input.dispatchClass === 'heavy_duty' ||
    input.dispatchClass === 'commercial'
  ) {
    return 'heavy';
  }
  if (
    input.dispatchClass === 'medium_duty' ||
    (input.gvwrLbs !== null && input.gvwrLbs >= 10_001) ||
    includesAny(input.bodyClass, ['pickup', 'truck', 'van', 'suv'])
  ) {
    return 'light_truck';
  }
  return 'passenger';
}

/**
 * Convenience wrapper over classifyVehicle for the common case where the
 * only signal is a linked vehicles row (the impound's vehicle_id). Returns
 * both the storage class and the EV flag (EV drives stall-type matching).
 * GVWR/axle are not on the vehicles table, so heavy classification here
 * relies on the dispatch class — wiring heavy-duty job attrs is a documented
 * follow-up (SESSION_54_DECISIONS.md).
 */
export function classifyFromVehicle(
  v: { vehicleClass: string | null; bodyClass: string | null; isElectric?: boolean | null } | null,
): { vehicleClass: StorageVehicleClass; isElectric: boolean } {
  return {
    vehicleClass: classifyVehicle({
      dispatchClass: v?.vehicleClass ?? null,
      bodyClass: v?.bodyClass ?? null,
      gvwrLbs: null,
      axleCount: null,
    }),
    isElectric: Boolean(v?.isElectric),
  };
}

// ----------------------------------------------------------------------
// resolveRate
// ----------------------------------------------------------------------

export interface RateCardLike {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  dailyRateCents: number;
  freeDays: number;
  maxDailyRateCents: number | null;
}

/**
 * Pick the rate card in effect on `chargeDate` (YYYY-MM-DD). Among cards
 * whose window covers the date, the one with the latest effective_from wins
 * (most recent override). Returns null when no card covers the date (a gap);
 * the caller surfaces that as "no rate configured" rather than charging $0.
 * `cards` must already be filtered to one facility + vehicle_class.
 */
export function resolveRate(cards: RateCardLike[], chargeDate: string): RateCardLike | null {
  const covering = cards.filter(
    (c) => c.effectiveFrom <= chargeDate && (c.effectiveTo === null || c.effectiveTo >= chargeDate),
  );
  if (covering.length === 0) return null;
  return covering.reduce((best, c) => (c.effectiveFrom > best.effectiveFrom ? c : best));
}

/** Do two rate cards' effective windows overlap? (open-ended = null end). */
export function rateWindowsOverlap(
  a: { effectiveFrom: string; effectiveTo: string | null },
  b: { effectiveFrom: string; effectiveTo: string | null },
): boolean {
  const aEnd = a.effectiveTo ?? '9999-12-31';
  const bEnd = b.effectiveTo ?? '9999-12-31';
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

// ----------------------------------------------------------------------
// computeDailyStorageCharge
// ----------------------------------------------------------------------

export interface DailyChargeResult {
  charged: boolean;
  amountCents: number;
}

/**
 * The charge for a single calendar day, given the rate card and the 0-based
 * `dayIndex` (0 = storage-start day). The first `freeDays` days are waived;
 * thereafter the daily rate applies, capped by max_daily_rate_cents when set.
 */
export function computeDailyStorageCharge(
  card: { dailyRateCents: number; freeDays: number; maxDailyRateCents: number | null },
  dayIndex: number,
): DailyChargeResult {
  if (dayIndex < 0) return { charged: false, amountCents: 0 };
  if (dayIndex < card.freeDays) return { charged: false, amountCents: 0 };
  const capped =
    card.maxDailyRateCents !== null
      ? Math.min(card.dailyRateCents, card.maxDailyRateCents)
      : card.dailyRateCents;
  return { charged: true, amountCents: Math.max(0, capped) };
}
