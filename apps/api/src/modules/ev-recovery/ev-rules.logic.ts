/**
 * EV recovery rule engine (EV Recovery, Session 48) — PURE functions.
 *
 *   requiredEquipmentForEv  — what gear the recovery needs (flatbed / dollies
 *                             / wheel-lift), given the vehicle + on-scene
 *                             facts. Conservative: unknown EV → flatbed only.
 *   thermalEventEscalation  — the fixed response for a battery thermal-event
 *                             severity (fire dept / hazmat / evac / lockdown).
 *   matchOemProcedure       — most-specific OEM procedure for a make/model/year.
 *
 * No mutation, no I/O. The service applies these; the UI/driver app surface
 * them. See SESSION_48_DECISIONS.md for the thermal matrix and the
 * conservative equipment defaults.
 */
import type {
  EvEquipmentRules,
  EvThermalEscalation,
  EvThermalSeverity,
} from '@ustowdispatch/shared';
import {
  FLATBED_ONLY,
  LOW_SOC_FLATBED_THRESHOLD_PCT,
  getTowProfile,
} from './ev-tow-profiles.config.js';

// ----------------------------------------------------------------------
// Equipment
// ----------------------------------------------------------------------

export interface EvEquipmentFacts {
  make: string | null;
  model: string | null;
  towModeEngaged: boolean;
  hvIsolated: boolean;
  stateOfChargePct: number | null;
  /** Planned wheels-down distance, miles. null/undefined = unknown long haul. */
  distanceMiles?: number | null;
  /** A thermal event was observed → recommend isolating the HV system. */
  thermalEventObserved?: boolean;
}

/**
 * Decide the towing equipment for an EV recovery. Defaults hard toward
 * flatbed: a wheels-down move is only permitted when the model has an explicit
 * short-distance allowance AND the planned distance is known to be within it
 * AND the pack is not critically low. Unknown vehicles are always flatbed.
 */
export function requiredEquipmentForEv(facts: EvEquipmentFacts): EvEquipmentRules {
  const reasons: string[] = [];
  const known = Boolean(facts.make);
  const profile = known ? getTowProfile(facts.make, facts.model) : FLATBED_ONLY;

  if (!known) {
    reasons.push('Unknown EV — flatbed only by default until the make/model is confirmed.');
  }

  const lowSoc =
    facts.stateOfChargePct !== null &&
    facts.stateOfChargePct !== undefined &&
    facts.stateOfChargePct <= LOW_SOC_FLATBED_THRESHOLD_PCT;

  const distance = facts.distanceMiles ?? null;
  const withinShortMove =
    profile.maxWheelDownMiles > 0 && distance !== null && distance <= profile.maxWheelDownMiles;

  // Wheel-lift is only OK for a known short move on a model that allows it,
  // and never when the pack is critically low (Transport/Neutral may fail).
  const wheelLiftAllowed = withinShortMove && !lowSoc;
  const dolliesAllowed = wheelLiftAllowed && profile.dolliesAllowed;
  const flatbedRequired = !wheelLiftAllowed;

  if (known && profile.maxWheelDownMiles === 0) {
    reasons.push(
      `${facts.make}${facts.model ? ` ${facts.model}` : ''} is flatbed-only per OEM guidance — never tow with wheels on the ground.`,
    );
  }
  if (lowSoc) {
    reasons.push(
      `State of charge ${facts.stateOfChargePct}% is at/below ${LOW_SOC_FLATBED_THRESHOLD_PCT}% — Transport/Neutral mode may be unavailable; flatbed only.`,
    );
  }
  if (profile.maxWheelDownMiles > 0 && distance === null && !lowSoc) {
    reasons.push(
      `Distance unknown — flatbed required unless the move is confirmed under ${profile.maxWheelDownMiles} mi.`,
    );
  }
  if (profile.maxWheelDownMiles > 0 && distance !== null && distance > profile.maxWheelDownMiles) {
    reasons.push(
      `Planned ${distance} mi exceeds the ${profile.maxWheelDownMiles} mi wheels-down limit — flatbed required.`,
    );
  }
  if (wheelLiftAllowed) {
    reasons.push(
      `Short ${distance} mi reposition within the ${profile.maxWheelDownMiles} mi limit — wheel-lift acceptable with drive wheels off the ground.`,
    );
  }

  const hvIsolationRequired = Boolean(facts.thermalEventObserved);
  if (hvIsolationRequired) {
    reasons.push('Thermal event observed — isolate the HV system before loading.');
  }

  return {
    flatbedRequired,
    dolliesAllowed,
    wheelLiftAllowed,
    maxWheelDownMiles: profile.maxWheelDownMiles,
    hvIsolationRequired,
    reasons,
  };
}

// ----------------------------------------------------------------------
// Thermal-event escalation
// ----------------------------------------------------------------------

// Conservative, fixed matrix. odor = monitor; swelling = notify + secure;
// smoke / venting / sparking / flames = full response. See decisions doc.
const ESCALATION: Record<EvThermalSeverity, EvThermalEscalation> = {
  odor: { fireDeptNotify: false, hazmatNotify: false, evacRequired: false, sceneLockdown: false },
  swelling: { fireDeptNotify: true, hazmatNotify: false, evacRequired: false, sceneLockdown: true },
  smoke: { fireDeptNotify: true, hazmatNotify: true, evacRequired: true, sceneLockdown: true },
  venting: { fireDeptNotify: true, hazmatNotify: true, evacRequired: true, sceneLockdown: true },
  sparking: { fireDeptNotify: true, hazmatNotify: true, evacRequired: true, sceneLockdown: true },
  flames: { fireDeptNotify: true, hazmatNotify: true, evacRequired: true, sceneLockdown: true },
};

export function thermalEventEscalation(severity: EvThermalSeverity): EvThermalEscalation {
  return ESCALATION[severity];
}

// ----------------------------------------------------------------------
// OEM procedure matching
// ----------------------------------------------------------------------

export interface OemMatchCandidate {
  make: string;
  model: string | null;
  modelYearFrom: number | null;
  modelYearTo: number | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function yearInRange(c: OemMatchCandidate, year: number | null | undefined): boolean {
  if (year === null || year === undefined) return true;
  if (c.modelYearFrom !== null && year < c.modelYearFrom) return false;
  if (c.modelYearTo !== null && year > c.modelYearTo) return false;
  return true;
}

// Prefer the most recent applicable range (largest modelYearFrom that still
// qualifies); a null from sorts last.
function byNewestFrom(a: OemMatchCandidate, b: OemMatchCandidate): number {
  return (b.modelYearFrom ?? -1) - (a.modelYearFrom ?? -1);
}

/**
 * Resolve the most specific OEM procedure for a vehicle: an exact model match
 * (within the year range) wins over a make-wide fallback (model IS NULL). When
 * nothing matches, returns null and the caller shows the generic EV safety
 * guidance instead.
 */
export function matchOemProcedure<T extends OemMatchCandidate>(
  candidates: T[],
  make: string,
  model?: string | null,
  year?: number | null,
): T | null {
  const m = norm(make);
  const byMake = candidates.filter((c) => norm(c.make) === m);
  if (byMake.length === 0) return null;

  if (model) {
    const md = norm(model);
    const modelMatches = byMake
      .filter((c) => c.model !== null && norm(c.model) === md && yearInRange(c, year))
      .sort(byNewestFrom);
    if (modelMatches.length > 0) return modelMatches[0] ?? null;
  }

  const makeWide = byMake
    .filter((c) => c.model === null && yearInRange(c, year))
    .sort(byNewestFrom);
  return makeWide[0] ?? null;
}
