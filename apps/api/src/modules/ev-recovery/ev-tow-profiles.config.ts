/**
 * EV Recovery (Session 48) — per-OEM tow-handling profiles for the equipment
 * rule engine.
 *
 * These capture, for the rule engine only, how far (if at all) a model may be
 * moved with wheels on the ground and whether dollies are acceptable. They
 * are intentionally CONSERVATIVE: nearly every modern EV is flatbed-only
 * (rolling the drive wheels back-feeds the motor and damages the drive unit),
 * so most profiles are maxWheelDownMiles 0. The human-readable OEM steps and
 * official-doc links live in the ev_oem_procedures table; this config is the
 * machine-readable handling cap. An UNKNOWN make/model resolves to the
 * flatbed-only default. Verify against the OEM service manual before relying
 * on any wheels-down allowance. See SESSION_48_DECISIONS.md.
 */

export interface EvTowProfile {
  /**
   * Miles the vehicle may be moved with its drive wheels off the ground
   * (wheel-lift + dollies), for a short reposition only. 0 = flatbed only.
   */
  maxWheelDownMiles: number;
  /** Whether dollies under the non-drive axle are acceptable at all. */
  dolliesAllowed: boolean;
}

/** Flatbed-only — the conservative default for any unrecognized EV. */
export const FLATBED_ONLY: EvTowProfile = { maxWheelDownMiles: 0, dolliesAllowed: false };

/**
 * SOC at or below this percentage may leave the vehicle unable to engage
 * Transport/Neutral mode (12V starved, contactors won't close, shifter
 * locked). Below it we force flatbed regardless of the model profile.
 */
export const LOW_SOC_FLATBED_THRESHOLD_PCT = 5;

function key(make: string, model?: string | null): string {
  return model
    ? `${make.trim().toLowerCase()}|${model.trim().toLowerCase()}`
    : make.trim().toLowerCase();
}

// Keyed by "make|model"; a bare "make" entry is the make-wide fallback.
const PROFILES: Record<string, EvTowProfile> = {
  // Tesla — flatbed only across the line (AWD drive units; RWD still
  // back-feeds the motor). Dollies never permitted.
  tesla: FLATBED_ONLY,
  // Chevrolet Bolt — FWD; GM permits a short wheel-lift move with the front
  // (drive) wheels OFF the ground. Flatbed for anything longer.
  'chevrolet|bolt ev': { maxWheelDownMiles: 5, dolliesAllowed: true },
  'chevrolet|bolt euv': { maxWheelDownMiles: 5, dolliesAllowed: true },
  // Nissan Leaf — FWD; very short repositions tolerated with drive wheels up.
  'nissan|leaf': { maxWheelDownMiles: 3, dolliesAllowed: true },
  // Everything else we seed is flatbed-only by manufacturer guidance.
  ford: FLATBED_ONLY,
  rivian: FLATBED_ONLY,
  lucid: FLATBED_ONLY,
  hyundai: FLATBED_ONLY,
  kia: FLATBED_ONLY,
  volkswagen: FLATBED_ONLY,
};

/**
 * Resolve the tow profile for a vehicle: an exact make|model entry wins; a
 * make-wide entry is the fallback; an unrecognized vehicle is FLATBED_ONLY.
 */
export function getTowProfile(make?: string | null, model?: string | null): EvTowProfile {
  if (!make) return FLATBED_ONLY;
  const exact = model ? PROFILES[key(make, model)] : undefined;
  if (exact) return exact;
  const makeWide = PROFILES[key(make)];
  if (makeWide) return makeWide;
  return FLATBED_ONLY;
}
