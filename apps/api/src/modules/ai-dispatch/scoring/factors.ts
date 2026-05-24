/**
 * AI Smart Dispatch (Session 41) — the six scoring factors, PURE.
 *
 * Each factor maps real-world facts to a 0..100 score plus a one-line detail
 * the UI shows in the breakdown. No I/O, no mutation. The service builds the
 * fact objects from DB rows; scoreCandidate (score-candidate.ts) weights and
 * composes them. Conservative defaults: missing data resolves to a neutral
 * mid-score rather than a hard 0 so the engine degrades gracefully when the
 * fleet is only partially instrumented. See SESSION_41_DECISIONS.md.
 */
import { haversineMiles } from './haversine.js';

export interface FactorResult {
  score: number;
  detail: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

// ----------------------------------------------------------------------
// 1. distance — proximity of the truck's last-known position to the pickup
// ----------------------------------------------------------------------

export interface DistanceFacts {
  truckLat: number | null;
  truckLng: number | null;
  pickupLat: number | null;
  pickupLng: number | null;
}

/** Each mile costs 2.5 points; 40+ mi → 0. Unknown position → neutral 50. */
export const DISTANCE_POINTS_PER_MILE = 2.5;

export function distanceScore(f: DistanceFacts): FactorResult {
  if (f.truckLat === null || f.truckLng === null || f.pickupLat === null || f.pickupLng === null) {
    return { score: 50, detail: 'Truck or pickup position unknown — neutral distance score.' };
  }
  const miles = haversineMiles(f.truckLat, f.truckLng, f.pickupLat, f.pickupLng);
  const score = clamp(100 - miles * DISTANCE_POINTS_PER_MILE);
  return { score, detail: `${miles.toFixed(1)} mi from pickup (straight-line).` };
}

// ----------------------------------------------------------------------
// 2. capability — equipment / class match for the job's service type
// ----------------------------------------------------------------------

/**
 * Equipment any of which satisfies a service type. Empty / absent = the service
 * imposes no specific equipment requirement (e.g. lockout, fuel). Values match
 * trucks.equipment allow-list (packages/db schema/trucks.ts).
 */
export const REQUIRED_EQUIPMENT_BY_SERVICE: Record<string, readonly string[]> = {
  tow: ['flatbed', 'wheel_lift', 'integrated'],
  winch: ['winch', 'wrecker_medium', 'wrecker_heavy', 'sliding_rotator'],
  recovery: ['wrecker_heavy', 'sliding_rotator', 'winch', 'integrated'],
  impound: ['flatbed', 'wheel_lift', 'integrated'],
};

export interface CapabilityFacts {
  serviceType: string;
  /** Job carries hd_job_attributes → needs a heavy-duty-capable truck. */
  requiresHeavyDuty: boolean;
  /** Job carries ev_job_attributes → EV, effectively flatbed-only. */
  isEv: boolean;
  truckEquipment: readonly string[];
  heavyDutyCapable: boolean;
}

export function capabilityScore(f: CapabilityFacts): FactorResult {
  if (f.requiresHeavyDuty && !f.heavyDutyCapable) {
    return { score: 0, detail: 'Heavy-duty job — truck is not HD-capable.' };
  }
  let score = 100;
  const notes: string[] = [];

  const required = REQUIRED_EQUIPMENT_BY_SERVICE[f.serviceType] ?? [];
  if (required.length > 0 && !required.some((e) => f.truckEquipment.includes(e))) {
    score -= 50;
    notes.push(`missing ${f.serviceType} equipment (${required.join('/')})`);
  }
  if (f.isEv && !f.truckEquipment.includes('flatbed')) {
    score -= 30;
    notes.push('EV needs a flatbed (no wheels-down)');
  }
  if (f.requiresHeavyDuty && f.heavyDutyCapable) {
    notes.push('HD-capable');
  }

  const score2 = clamp(score);
  const detail = notes.length > 0 ? notes.join('; ') : 'Equipment matches the service type.';
  return { score: score2, detail };
}

// ----------------------------------------------------------------------
// 3. cert_match — driver holds the certs the job legally / safely requires
// ----------------------------------------------------------------------

export interface CertFacts {
  serviceType: string;
  requiresHeavyDuty: boolean;
  isEv: boolean;
  /** drivers.certifications (e.g. WreckMaster_4_5, Tesla_certified). */
  driverCerts: readonly string[];
  /** Live hd_driver_certifications cert_type values (e.g. hd_operator, rotator). */
  hdCertTypes: readonly string[];
  /** drivers.cdl_class — 'A' | 'B' | 'C' | 'non_cdl' | 'none'. */
  cdlClass: string;
}

export function certMatchScore(f: CertFacts): FactorResult {
  let score = 100;
  const notes: string[] = [];

  if (f.requiresHeavyDuty) {
    if (!f.hdCertTypes.includes('hd_operator')) {
      score -= 50;
      notes.push('no HD operator cert');
    }
    if (f.cdlClass !== 'A' && f.cdlClass !== 'B') {
      score -= 20;
      notes.push('no Class A/B CDL');
    }
  }
  if (f.isEv && !f.driverCerts.includes('Tesla_certified')) {
    score -= 30;
    notes.push('no EV/Tesla cert');
  }
  if (
    (f.serviceType === 'recovery' || f.serviceType === 'winch') &&
    !f.driverCerts.some((c) => c.startsWith('WreckMaster'))
  ) {
    score -= 20;
    notes.push('no WreckMaster cert for recovery');
  }

  const detail = notes.length > 0 ? notes.join('; ') : 'Driver holds the required certifications.';
  return { score: clamp(score), detail };
}

// ----------------------------------------------------------------------
// 4. fatigue — hours on shift in the last 24h (fresher driver scores higher)
// ----------------------------------------------------------------------

/** Below this many hours the driver is considered fully fresh (score 100). */
export const FATIGUE_FRESH_HOURS = 8;
/** At/above this many hours the driver is fully fatigued (score 0) — past HOS. */
export const FATIGUE_MAX_HOURS = 14;

export function fatigueScore(hoursOnShiftLast24h: number): FactorResult {
  const hours = Math.max(0, hoursOnShiftLast24h);
  if (hours <= FATIGUE_FRESH_HOURS) {
    return { score: 100, detail: `${hours.toFixed(1)}h on shift in last 24h — fresh.` };
  }
  const span = FATIGUE_MAX_HOURS - FATIGUE_FRESH_HOURS;
  const score = clamp(100 - ((hours - FATIGUE_FRESH_HOURS) / span) * 100);
  return { score, detail: `${hours.toFixed(1)}h on shift in last 24h — fatigue risk.` };
}

// ----------------------------------------------------------------------
// 5. historical_performance — driver's avg |ETA error| on recent similar jobs
// ----------------------------------------------------------------------

/** Each minute of mean absolute ETA error costs 4 points. */
export const HISTORICAL_POINTS_PER_MINUTE = 4;

export function historicalPerformanceScore(avgAbsEtaErrorMinutes: number | null): FactorResult {
  if (avgAbsEtaErrorMinutes === null) {
    return { score: 50, detail: 'No recent ETA history — neutral score.' };
  }
  const err = Math.max(0, avgAbsEtaErrorMinutes);
  const score = clamp(100 - err * HISTORICAL_POINTS_PER_MINUTE);
  return { score, detail: `Avg ETA error ${err.toFixed(1)} min on recent similar jobs.` };
}

// ----------------------------------------------------------------------
// 6. utilization_balance — prefer drivers under the tenant weekly average
// ----------------------------------------------------------------------

export function utilizationBalanceScore(
  driverCompletedThisWeek: number,
  tenantAvgCompletedThisWeek: number,
): FactorResult {
  if (tenantAvgCompletedThisWeek <= 0) {
    return { score: 50, detail: 'No completions yet this week — neutral balance.' };
  }
  // Scale-invariant: at the tenant average → 50; at zero → 100; at 2× → 0.
  const ratio = driverCompletedThisWeek / tenantAvgCompletedThisWeek;
  const score = clamp(100 - ratio * 50);
  return {
    score,
    detail: `${driverCompletedThisWeek} completed this week vs tenant avg ${tenantAvgCompletedThisWeek.toFixed(1)}.`,
  };
}
