/**
 * CADS pure math — ratio, weighting, band mapping, hysteresis/dwell,
 * override precedence. No I/O, no Nest — unit tested directly (the same
 * split as dynamic-pricing-helpers.ts / webhook-retry.logic.ts).
 *
 *   load_ratio = weighted_active_jobs / eligible_signed_in_drivers
 *
 * Zero eligible drivers => OFFLINE (never a divide-by-zero, never
 * AT_CAPACITY). Band changes are damped: the ratio must cross the band
 * boundary by more than `hysteresisBuffer`, OR sit across it for
 * `hysteresisDwellSeconds`, before the published band moves. OFFLINE
 * transitions bypass hysteresis in both directions — driver headcount is
 * a hard fact, not a noisy signal.
 */
import type { CapacityBand, CapacityClassScope, CapacityDutyClass } from '@ustowdispatch/shared';

export interface BandThresholds {
  availableMaxRatio: number;
  limitedMaxRatio: number;
  constrainedMaxRatio: number;
}

export interface HysteresisSettings extends BandThresholds {
  hysteresisBuffer: number;
  hysteresisDwellSeconds: number;
}

/** Raw per-class tallies straight from the eligibility + jobs queries. */
export interface ClassTally {
  dutyClass: CapacityClassScope;
  eligibleDrivers: number;
  weightedActiveJobs: number;
}

/** ratio is null exactly when the class is OFFLINE. */
export interface ComputedClass extends ClassTally {
  ratio: number | null;
  band: CapacityBand;
}

/** Rank for comparing non-offline bands (worse = higher). */
const BAND_RANK: Record<Exclude<CapacityBand, 'offline'>, number> = {
  available_now: 0,
  limited: 1,
  constrained: 2,
  at_capacity: 3,
};

export function loadRatio(weightedActiveJobs: number, eligibleDrivers: number): number | null {
  if (eligibleDrivers <= 0) return null;
  return weightedActiveJobs / eligibleDrivers;
}

/** Sum of weight per job status; statuses absent from the map count 0. */
export function weightedJobs(
  statusCounts: Readonly<Record<string, number>>,
  weights: Readonly<Record<string, number>>,
): number {
  let total = 0;
  for (const [status, count] of Object.entries(statusCounts)) {
    const w = weights[status];
    if (w !== undefined && w > 0 && count > 0) total += w * count;
  }
  return total;
}

/** Map a ratio to its raw band (no hysteresis). null ratio => offline. */
export function bandForRatio(ratio: number | null, t: BandThresholds): CapacityBand {
  if (ratio === null) return 'offline';
  if (ratio <= t.availableMaxRatio) return 'available_now';
  if (ratio <= t.limitedMaxRatio) return 'limited';
  if (ratio <= t.constrainedMaxRatio) return 'constrained';
  return 'at_capacity';
}

export function computeClass(tally: ClassTally, t: BandThresholds): ComputedClass {
  const ratio = loadRatio(tally.weightedActiveJobs, tally.eligibleDrivers);
  return { ...tally, ratio, band: bandForRatio(ratio, t) };
}

/**
 * Per-class anti-flapping state, cached in Redis between recomputes.
 * `band` is the last PUBLISHED band; `pendingBand`/`pendingSince` track a
 * raw band that differs from it but hasn't yet earned the change.
 */
export interface HysteresisState {
  band: CapacityBand;
  pendingBand: CapacityBand | null;
  /** ISO timestamp of when pendingBand was first observed. */
  pendingSince: string | null;
}

export interface HysteresisResult {
  state: HysteresisState;
  /** True when state.band differs from the previous published band. */
  transitioned: boolean;
}

/**
 * Decide the published band given the freshly computed raw band.
 *
 *  - raw === published        -> hold, clear any pending.
 *  - offline either side      -> immediate (headcount is a fact).
 *  - crossed boundary+buffer  -> immediate.
 *  - else                     -> pending until dwell elapses.
 */
export function applyHysteresis(
  prev: HysteresisState | null,
  ratio: number | null,
  rawBand: CapacityBand,
  s: HysteresisSettings,
  now: Date,
): HysteresisResult {
  // First observation ever: publish the raw band as-is.
  if (!prev) {
    return { state: { band: rawBand, pendingBand: null, pendingSince: null }, transitioned: true };
  }

  if (rawBand === prev.band) {
    return {
      state: { band: prev.band, pendingBand: null, pendingSince: null },
      transitioned: false,
    };
  }

  // OFFLINE transitions bypass hysteresis entirely.
  if (rawBand === 'offline' || prev.band === 'offline') {
    return { state: { band: rawBand, pendingBand: null, pendingSince: null }, transitioned: true };
  }

  // Buffer check: nudge the ratio back toward the published band by
  // `buffer`; if it STILL maps past the published band, the boundary was
  // crossed decisively.
  const movingUp =
    BAND_RANK[rawBand as keyof typeof BAND_RANK] > BAND_RANK[prev.band as keyof typeof BAND_RANK];
  if (ratio !== null) {
    const nudged = movingUp ? Math.max(0, ratio - s.hysteresisBuffer) : ratio + s.hysteresisBuffer;
    const nudgedBand = bandForRatio(nudged, s);
    if (nudgedBand !== 'offline') {
      const nudgedRank = BAND_RANK[nudgedBand as keyof typeof BAND_RANK];
      const prevRank = BAND_RANK[prev.band as keyof typeof BAND_RANK];
      if ((movingUp && nudgedRank > prevRank) || (!movingUp && nudgedRank < prevRank)) {
        return {
          state: { band: rawBand, pendingBand: null, pendingSince: null },
          transitioned: true,
        };
      }
    }
  }

  // Inside the buffer zone: dwell. Keep publishing the old band until the
  // SAME candidate band has been observed for dwellSeconds.
  if (prev.pendingBand === rawBand && prev.pendingSince) {
    const heldMs = now.getTime() - Date.parse(prev.pendingSince);
    if (heldMs >= s.hysteresisDwellSeconds * 1000) {
      return {
        state: { band: rawBand, pendingBand: null, pendingSince: null },
        transitioned: true,
      };
    }
    return { state: prev, transitioned: false };
  }
  return {
    state: { band: prev.band, pendingBand: rawBand, pendingSince: now.toISOString() },
    transitioned: false,
  };
}

/**
 * Override precedence: a scope-specific override beats the global 'all'
 * override beats the computed band. Returns the band to PUBLISH for the
 * class plus whether an override supplied it.
 */
export function effectiveBand(
  dutyClass: CapacityClassScope,
  computedBand: CapacityBand,
  overrides: ReadonlyArray<{ dutyClass: CapacityClassScope; forcedBand: CapacityBand }>,
): { band: CapacityBand; overrideActive: boolean } {
  const scoped = overrides.find((o) => o.dutyClass === dutyClass);
  if (scoped) return { band: scoped.forcedBand, overrideActive: true };
  const global = overrides.find((o) => o.dutyClass === 'all');
  if (global) return { band: global.forcedBand, overrideActive: true };
  return { band: computedBand, overrideActive: false };
}

/** An override is active while it is uncleared and unexpired. */
export function isOverrideActive(
  o: { clearedAt: Date | null; expiresAt: Date; deletedAt: Date | null },
  now: Date,
): boolean {
  return o.deletedAt === null && o.clearedAt === null && o.expiresAt.getTime() > now.getTime();
}

/** Blend the concrete classes into the company-wide 'all' tally. */
export function blendClasses(classes: ReadonlyArray<ClassTally>): ClassTally {
  let drivers = 0;
  let jobs = 0;
  for (const c of classes) {
    drivers += c.eligibleDrivers;
    jobs += c.weightedActiveJobs;
  }
  return { dutyClass: 'all', eligibleDrivers: drivers, weightedActiveJobs: jobs };
}

export const CONCRETE_DUTY_CLASSES: readonly CapacityDutyClass[] = ['light', 'medium', 'heavy'];
