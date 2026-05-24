/**
 * Driver-qualification file completeness (pure) — Full DOT Compliance,
 * Session 37 (49 CFR 391.51).
 *
 * The DQ file spans two rows: the `drivers` row (license, CDL class,
 * medical card, drug-test and road-test dates — single source of truth)
 * and the dot_driver_qualifications extension (employment application,
 * MVR). This function merges them into { complete, missing[], expiring[] }.
 *
 * An item is "missing" when absent OR (for dated items) expired as of
 * `today`. An item is "expiring" when present, not yet expired, and within
 * DQ_EXPIRY_WARNING_DAYS — the same 60-day horizon the expiry cron alerts
 * on.
 */
import type { DqExpiringItem, DqFileItem } from '@ustowdispatch/shared';

export const DQ_EXPIRY_WARNING_DAYS = 60;

export interface DqDriverFacts {
  cdlClass: string;
  licenseNumber: string | null;
  licenseExpiresAt: string | null;
  medicalCardExpiresAt: string | null;
  drugTestLastAt: string | null;
  roadTestCompletedAt: string | null;
}

export interface DqExtensionFacts {
  employmentAppSignedAt: string | null;
  mvrPulledAt: string | null;
  mvrExpiresAt: string | null;
}

export interface DqFileResult {
  complete: boolean;
  missing: DqFileItem[];
  expiring: DqExpiringItem[];
}

const MS_PER_DAY = 86_400_000;

const parse = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysUntil = (target: Date, today: Date): number =>
  Math.floor((target.getTime() - today.getTime()) / MS_PER_DAY);

export function dqFileStatus(
  driver: DqDriverFacts,
  ext: DqExtensionFacts | null,
  today: Date = new Date(),
): DqFileResult {
  const missing: DqFileItem[] = [];
  const expiring: DqExpiringItem[] = [];

  // Presence-only items.
  if (!ext?.employmentAppSignedAt) missing.push('employment_application');
  if (!driver.licenseNumber) missing.push('drivers_license');
  if (!driver.drugTestLastAt) missing.push('drug_test');
  if (!driver.roadTestCompletedAt) missing.push('road_test');
  if (!ext?.mvrPulledAt) missing.push('mvr');

  // Dated items: missing if absent or expired; expiring if within the horizon.
  const dated: { item: DqFileItem; value: string | null }[] = [
    { item: 'license_expiry', value: driver.licenseExpiresAt },
    { item: 'medical_certificate', value: driver.medicalCardExpiresAt },
  ];
  // MVR expiry only counts once the MVR has actually been pulled.
  if (ext?.mvrPulledAt) {
    dated.push({ item: 'mvr', value: ext.mvrExpiresAt });
  }

  for (const { item, value } of dated) {
    const when = parse(value);
    if (!when) {
      // No expiry date on a required dated item ⇒ treat as missing
      // (license_expiry / medical_certificate). MVR handled above.
      if (item !== 'mvr') missing.push(item);
      continue;
    }
    const left = daysUntil(when, today);
    if (left < 0) {
      missing.push(item);
    } else if (left <= DQ_EXPIRY_WARNING_DAYS) {
      expiring.push({ item, expiresAt: value as string, daysLeft: left });
    }
  }

  // De-dupe missing (mvr can be added by presence check only).
  const uniqueMissing = [...new Set(missing)];
  return { complete: uniqueMissing.length === 0, missing: uniqueMissing, expiring };
}
