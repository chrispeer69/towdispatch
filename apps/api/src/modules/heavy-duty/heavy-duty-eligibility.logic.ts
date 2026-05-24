/**
 * Pure HD dispatch-eligibility logic. No I/O, no Nest, no DB — deterministic
 * and unit-tested directly. The service loads the candidate trucks /
 * drivers + their HD detail rows and feeds them here; these functions never
 * touch dispatch core (they only read), satisfying the "expose filter
 * helpers, don't fork dispatch" constraint.
 *
 * Hazmat note: hazmat capability is modelled as a DRIVER certification
 * (operator endorsement), not a truck attribute — hd_truck_capabilities has
 * no hazmat column. So a job's requiresHazmat gates the driver pool, not the
 * truck pool. See SESSION_36_DECISIONS.md.
 */
import type { HdDriverCertType } from '@ustowdispatch/shared';

/**
 * FMCSA GVWR class from a gross-vehicle-weight rating in pounds. Class 8 is
 * open-ended (> 33,000 lb). Mirrors the federal bracket table; kept here so
 * the categorical gvwr_class column and a raw vehicle_gvwr_lbs stay
 * reconcilable without a DB-derived column.
 */
export function gvwrLbsToClass(gvwrLbs: number): number {
  if (gvwrLbs <= 6_000) return 1;
  if (gvwrLbs <= 10_000) return 2;
  if (gvwrLbs <= 14_000) return 3;
  if (gvwrLbs <= 16_000) return 4;
  if (gvwrLbs <= 19_500) return 5;
  if (gvwrLbs <= 26_000) return 6;
  if (gvwrLbs <= 33_000) return 7;
  return 8;
}

/** The job's HD requirements eligibility filters against. */
export interface HdJobRequirements {
  vehicleClass: number | null;
  vehicleGvwrLbs: number | null;
  requiresRotator: boolean;
  requiresHazmat: boolean;
}

/**
 * Effective FMCSA class of the towed unit: the explicit vehicle_class when
 * set, else derived from vehicle_gvwr_lbs, else null (unknown).
 */
export function effectiveJobClass(job: HdJobRequirements): number | null {
  if (job.vehicleClass != null) return job.vehicleClass;
  if (job.vehicleGvwrLbs != null) return gvwrLbsToClass(job.vehicleGvwrLbs);
  return null;
}

/** Class 7+ recoveries require a CDL operator. Hazmat loads do too. */
export function cdlRequiredForJob(job: HdJobRequirements): boolean {
  const cls = effectiveJobClass(job);
  return (cls != null && cls >= 7) || job.requiresHazmat;
}

// ----------------------------------------------------------------------
// Trucks
// ----------------------------------------------------------------------

export interface TruckFacts {
  truckId: string;
  unitNumber: string;
  /** trucks.status — only 'active' is dispatchable. */
  status: string;
  heavyDutyCapable: boolean;
  /** hd_truck_capabilities row present? */
  hasCapabilities: boolean;
  gvwrClass: number | null;
  hasRotator: boolean;
  maxRecoveryWeightLbs: number | null;
}

export interface EligibleTruckResult {
  truckId: string;
  unitNumber: string;
  eligible: boolean;
  reasons: string[];
  gvwrClass: number | null;
  hasRotator: boolean;
  maxRecoveryWeightLbs: number | null;
}

/**
 * Filter trucks for an HD job by GVWR class, rotator need, and rated
 * recovery weight. A truck is eligible only when none of the gates fire;
 * `reasons` always explains an ineligible truck (and is empty when
 * eligible). Pure — the caller decides which trucks to pass in (the HD
 * fleet: heavy_duty_capable or with a capabilities row).
 */
export function eligibleTrucksForHdJob(
  job: HdJobRequirements,
  trucks: TruckFacts[],
): EligibleTruckResult[] {
  const requiredClass = effectiveJobClass(job);
  const results = trucks.map((t) => {
    const reasons: string[] = [];

    if (t.status !== 'active') {
      reasons.push(`Truck is ${t.status} (not active)`);
    }
    if (!t.hasCapabilities) {
      reasons.push('No HD capability profile on file');
    }

    if (requiredClass != null) {
      if (t.gvwrClass == null) {
        reasons.push(`Truck GVWR class unknown; job needs class ${requiredClass}`);
      } else if (t.gvwrClass < requiredClass) {
        reasons.push(`Truck rated class ${t.gvwrClass} is below required class ${requiredClass}`);
      }
    }

    if (job.requiresRotator && !t.hasRotator) {
      reasons.push('Job requires a rotator; truck has none');
    }

    if (
      job.vehicleGvwrLbs != null &&
      t.maxRecoveryWeightLbs != null &&
      job.vehicleGvwrLbs > t.maxRecoveryWeightLbs
    ) {
      reasons.push(
        `Vehicle weight ${job.vehicleGvwrLbs} lb exceeds truck rated recovery ${t.maxRecoveryWeightLbs} lb`,
      );
    }

    return {
      truckId: t.truckId,
      unitNumber: t.unitNumber,
      eligible: reasons.length === 0,
      reasons,
      gvwrClass: t.gvwrClass,
      hasRotator: t.hasRotator,
      maxRecoveryWeightLbs: t.maxRecoveryWeightLbs,
    };
  });
  // Eligible first, then by unit number for a stable panel order.
  return results.sort(
    (a, b) => Number(b.eligible) - Number(a.eligible) || a.unitNumber.localeCompare(b.unitNumber),
  );
}

// ----------------------------------------------------------------------
// Drivers
// ----------------------------------------------------------------------

export interface DriverCertFact {
  certType: HdDriverCertType;
  /** YYYY-MM-DD or null (no expiry recorded → treated as non-expiring). */
  expiresAt: string | null;
}

export interface DriverFacts {
  driverId: string;
  name: string;
  /** drivers.active — terminated / on-leave drivers are excluded. */
  active: boolean;
  certs: DriverCertFact[];
}

export interface EligibleDriverResult {
  driverId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  missingCerts: HdDriverCertType[];
  expiredCerts: HdDriverCertType[];
}

const CERT_LABEL: Record<HdDriverCertType, string> = {
  hd_operator: 'HD operator',
  rotator: 'rotator',
  hazmat: 'hazmat',
  cdl_a: 'CDL-A',
  cdl_b: 'CDL-B',
};

/**
 * Filter drivers for an HD job by certification presence + non-expiry, as of
 * `today` (YYYY-MM-DD). A cert with a null expiry never expires; an expiry
 * equal to today is still valid (expires at end of day). Required set:
 * hd_operator always; rotator / hazmat when the job needs them; a CDL (A or
 * B) for class-7+ or hazmat jobs.
 */
export function eligibleDriversForHdJob(
  job: HdJobRequirements,
  drivers: DriverFacts[],
  today: string,
): EligibleDriverResult[] {
  const results = drivers.map((d) => {
    const reasons: string[] = [];
    const missingCerts: HdDriverCertType[] = [];
    const expiredCerts: HdDriverCertType[] = [];

    const byType = new Map<HdDriverCertType, string | null>();
    for (const c of d.certs) byType.set(c.certType, c.expiresAt);

    const isPresent = (t: HdDriverCertType): boolean => byType.has(t);
    const isExpired = (t: HdDriverCertType): boolean => {
      const exp = byType.get(t);
      return exp != null && exp < today;
    };
    const isLive = (t: HdDriverCertType): boolean => isPresent(t) && !isExpired(t);

    if (!d.active) reasons.push('Driver is not active');

    const required: HdDriverCertType[] = ['hd_operator'];
    if (job.requiresRotator) required.push('rotator');
    if (job.requiresHazmat) required.push('hazmat');

    for (const cert of required) {
      if (!isPresent(cert)) {
        missingCerts.push(cert);
        reasons.push(`Missing ${CERT_LABEL[cert]} certification`);
      } else if (isExpired(cert)) {
        expiredCerts.push(cert);
        reasons.push(`${CERT_LABEL[cert]} certification expired`);
      }
    }

    if (cdlRequiredForJob(job)) {
      const cdlLive = isLive('cdl_a') || isLive('cdl_b');
      if (!cdlLive) {
        const cdlPresent = isPresent('cdl_a') || isPresent('cdl_b');
        if (cdlPresent) {
          if (isPresent('cdl_a') && isExpired('cdl_a')) expiredCerts.push('cdl_a');
          if (isPresent('cdl_b') && isExpired('cdl_b')) expiredCerts.push('cdl_b');
          reasons.push('Valid CDL (A/B) required — on file but expired');
        } else {
          missingCerts.push('cdl_a');
          reasons.push('Valid CDL (A/B) required');
        }
      }
    }

    return {
      driverId: d.driverId,
      name: d.name,
      eligible: reasons.length === 0,
      reasons,
      missingCerts,
      expiredCerts,
    };
  });
  return results.sort(
    (a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name),
  );
}

// ----------------------------------------------------------------------
// Cert expiry status (shared by the roster report + the cron)
// ----------------------------------------------------------------------

export type HdCertStatusKind = 'valid' | 'expiring' | 'expired' | 'unknown';

/** Whole-day difference today→expiry (negative = already past). */
export function daysUntil(today: string, expiresAt: string): number {
  const a = Date.parse(`${today}T00:00:00.000Z`);
  const b = Date.parse(`${expiresAt}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Cert status as of `today`. No expiry → 'valid' (non-expiring). Within
 * `windowDays` (inclusive, default 30) → 'expiring'. Past → 'expired'.
 */
export function certStatus(
  expiresAt: string | null,
  today: string,
  windowDays = 30,
): { status: HdCertStatusKind; daysUntilExpiry: number | null } {
  if (expiresAt == null) return { status: 'valid', daysUntilExpiry: null };
  const d = daysUntil(today, expiresAt);
  if (d < 0) return { status: 'expired', daysUntilExpiry: d };
  if (d <= windowDays) return { status: 'expiring', daysUntilExpiry: d };
  return { status: 'valid', daysUntilExpiry: d };
}
