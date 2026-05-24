/**
 * Fraud-detection signal engine (Session 43) — PURE functions.
 *
 * Each detector consumes a single assembled `JobFraudFacts` object and returns
 * one `DetectedSignal` or null. Detectors NEVER touch the DB and NEVER throw:
 * when a fact source is unavailable (no telemetry GPS, no operator-hours
 * config, no invoice) the detector returns null rather than half-firing. The
 * service assembles facts and persists results; the cron only reads them.
 *
 * computeCompositeScore turns the fired signals into a 0-100 score + band
 * using the documented weights in fraud-rules.config.ts. Everything here is
 * deterministic and unit-tested per detector (positive / negative / edge).
 */
import type {
  FraudRiskBand,
  FraudScoreTopSignal,
  FraudSeverity,
  FraudSignalType,
} from '@ustowdispatch/shared';
import {
  BAND_THRESHOLDS,
  CASH_PATTERN_MIN_JOBS,
  DRIVER_ANOMALY_MULTIPLIER,
  DUPLICATE_WINDOW_DAYS,
  GEOFENCE_MAX_MILES,
  MILEAGE_RATIO_THRESHOLD,
  MISSING_EVIDENCE_MIN_CENTS,
  MISSING_EVIDENCE_MIN_PHOTOS,
  RESEQUENCING_FLIP_THRESHOLD,
  SEVERITY_MULTIPLIER,
  SIGNAL_WEIGHTS,
} from './fraud-rules.config.js';

const DAY_MS = 86_400_000;

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Everything the 9 detectors need, assembled once by the service. Fields are
 * deliberately granular + nullable: a null/undefined input makes the relevant
 * detector return null (no false positive on missing data).
 */
export interface JobFraudFacts {
  jobId: string;

  // duplicate_invoice
  vin: string | null;
  motorClubName: string | null;
  jobCreatedAt: Date;
  /** Other jobs with the same VIN + motor club (excluding this job). */
  siblingJobs: { jobId: string; createdAt: Date }[];

  // excessive_mileage
  billedMiles: number | null;
  geocodedMiles: number | null;

  // rapid_resequencing — count of back-and-forth status reversals.
  statusReversalCount: number;

  // off_hours_dispatch
  dispatchHourLocal: number | null; // 0-23; null when never dispatched
  operatorOpenHour: number;
  operatorCloseHour: number;
  afterHoursFlag: boolean;

  // missing_evidence
  invoiceTotalCents: number | null;
  evidencePhotoCount: number;

  // driver_anomaly
  driverJobsOnDay: number | null;
  driver30dAvgPerDay: number | null;

  // cash_only_pattern
  customerName: string | null;
  customerCashJobCount: number; // cash-paid jobs sharing this customer name (incl. this)

  // geofence_violation
  billedDropoff: GeoPoint | null;
  actualDropoff: GeoPoint | null;

  // bill_to_storage_acceleration
  billedStorageDays: number | null;
  actualStorageDays: number | null;
}

export interface DetectedSignal {
  signalType: FraudSignalType;
  severity: FraudSeverity;
  confidencePct: number; // 0-100
  payload: Record<string, unknown>;
}

// ----------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const R = 3958.7613; // earth radius, miles
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ----------------------------------------------------------------------
// Detectors
// ----------------------------------------------------------------------

export function detectDuplicateInvoice(f: JobFraudFacts): DetectedSignal | null {
  if (!f.vin || !f.motorClubName) return null;
  let closestDays = Number.POSITIVE_INFINITY;
  let dupId: string | null = null;
  for (const sib of f.siblingJobs) {
    const days = Math.abs(sib.createdAt.getTime() - f.jobCreatedAt.getTime()) / DAY_MS;
    if (days <= DUPLICATE_WINDOW_DAYS && days < closestDays) {
      closestDays = days;
      dupId = sib.jobId;
    }
  }
  if (dupId === null) return null;
  // Same-day duplicates are near-certain; widening the gap lowers confidence.
  const confidence = clampPct(90 - (closestDays / DUPLICATE_WINDOW_DAYS) * 25);
  return {
    signalType: 'duplicate_invoice',
    severity: 'high',
    confidencePct: confidence,
    payload: {
      duplicateJobId: dupId,
      vin: f.vin,
      motorClubName: f.motorClubName,
      gapDays: Number(closestDays.toFixed(2)),
    },
  };
}

export function detectExcessiveMileage(f: JobFraudFacts): DetectedSignal | null {
  if (f.billedMiles === null || f.geocodedMiles === null) return null;
  if (f.geocodedMiles <= 0 || f.billedMiles <= 0) return null;
  const ratio = f.billedMiles / f.geocodedMiles;
  if (ratio <= MILEAGE_RATIO_THRESHOLD) return null;
  const severity: FraudSeverity = ratio > 2 ? 'high' : ratio > 1.5 ? 'medium' : 'low';
  const confidence = clampPct(40 + (ratio - MILEAGE_RATIO_THRESHOLD) * 60);
  return {
    signalType: 'excessive_mileage',
    severity,
    confidencePct: confidence,
    payload: {
      billedMiles: f.billedMiles,
      geocodedMiles: f.geocodedMiles,
      ratio: Number(ratio.toFixed(2)),
      thresholdRatio: MILEAGE_RATIO_THRESHOLD,
    },
  };
}

export function detectRapidResequencing(f: JobFraudFacts): DetectedSignal | null {
  if (f.statusReversalCount <= RESEQUENCING_FLIP_THRESHOLD) return null;
  const severity: FraudSeverity = f.statusReversalCount > 5 ? 'high' : 'medium';
  const confidence = clampPct(50 + (f.statusReversalCount - RESEQUENCING_FLIP_THRESHOLD) * 10);
  return {
    signalType: 'rapid_resequencing',
    severity,
    confidencePct: confidence,
    payload: {
      reversalCount: f.statusReversalCount,
      threshold: RESEQUENCING_FLIP_THRESHOLD,
    },
  };
}

export function detectOffHoursDispatch(f: JobFraudFacts): DetectedSignal | null {
  if (f.dispatchHourLocal === null) return null;
  if (f.afterHoursFlag) return null; // legitimately flagged after-hours work
  const h = f.dispatchHourLocal;
  const within = h >= f.operatorOpenHour && h < f.operatorCloseHour;
  if (within) return null;
  // How far outside the window (hours), bounded for confidence scaling.
  const before = f.operatorOpenHour - h;
  const after = h - (f.operatorCloseHour - 1);
  const hoursOutside = Math.max(before, after, 0);
  const severity: FraudSeverity = hoursOutside >= 3 ? 'medium' : 'low';
  return {
    signalType: 'off_hours_dispatch',
    severity,
    confidencePct: clampPct(45 + hoursOutside * 8),
    payload: {
      dispatchHourLocal: h,
      operatorOpenHour: f.operatorOpenHour,
      operatorCloseHour: f.operatorCloseHour,
    },
  };
}

export function detectMissingEvidence(f: JobFraudFacts): DetectedSignal | null {
  if (f.invoiceTotalCents === null) return null;
  if (f.invoiceTotalCents < MISSING_EVIDENCE_MIN_CENTS) return null;
  if (f.evidencePhotoCount >= MISSING_EVIDENCE_MIN_PHOTOS) return null;
  // Deterministic gap; confidence rises with how far the invoice clears the bar.
  const overBy = f.invoiceTotalCents / MISSING_EVIDENCE_MIN_CENTS;
  return {
    signalType: 'missing_evidence',
    severity: 'medium',
    confidencePct: clampPct(70 + Math.min(overBy - 1, 1) * 25),
    payload: {
      invoiceTotalCents: f.invoiceTotalCents,
      evidencePhotoCount: f.evidencePhotoCount,
      minPhotos: MISSING_EVIDENCE_MIN_PHOTOS,
    },
  };
}

export function detectDriverAnomaly(f: JobFraudFacts): DetectedSignal | null {
  if (f.driverJobsOnDay === null || f.driver30dAvgPerDay === null) return null;
  if (f.driver30dAvgPerDay <= 0) return null;
  const ratio = f.driverJobsOnDay / f.driver30dAvgPerDay;
  if (ratio < DRIVER_ANOMALY_MULTIPLIER) return null;
  const severity: FraudSeverity = ratio >= 3 ? 'high' : 'medium';
  return {
    signalType: 'driver_anomaly',
    severity,
    confidencePct: clampPct(40 + (ratio - DRIVER_ANOMALY_MULTIPLIER) * 30),
    payload: {
      jobsOnDay: f.driverJobsOnDay,
      avgPerDay: Number(f.driver30dAvgPerDay.toFixed(2)),
      ratio: Number(ratio.toFixed(2)),
    },
  };
}

export function detectCashOnlyPattern(f: JobFraudFacts): DetectedSignal | null {
  if (!f.customerName) return null;
  if (f.customerCashJobCount < CASH_PATTERN_MIN_JOBS) return null;
  const severity: FraudSeverity = f.customerCashJobCount >= 5 ? 'medium' : 'low';
  return {
    signalType: 'cash_only_pattern',
    severity,
    confidencePct: clampPct(40 + (f.customerCashJobCount - CASH_PATTERN_MIN_JOBS) * 12),
    payload: {
      customerName: f.customerName,
      cashJobCount: f.customerCashJobCount,
      threshold: CASH_PATTERN_MIN_JOBS,
    },
  };
}

export function detectGeofenceViolation(f: JobFraudFacts): DetectedSignal | null {
  if (!f.billedDropoff || !f.actualDropoff) return null;
  const miles = haversineMiles(f.billedDropoff, f.actualDropoff);
  if (miles <= GEOFENCE_MAX_MILES) return null;
  const severity: FraudSeverity = miles > 10 ? 'high' : 'medium';
  return {
    signalType: 'geofence_violation',
    severity,
    confidencePct: clampPct(50 + (miles - GEOFENCE_MAX_MILES) * 5),
    payload: {
      distanceMiles: Number(miles.toFixed(2)),
      thresholdMiles: GEOFENCE_MAX_MILES,
    },
  };
}

export function detectBillToStorageAcceleration(f: JobFraudFacts): DetectedSignal | null {
  if (f.billedStorageDays === null || f.actualStorageDays === null) return null;
  if (f.billedStorageDays <= f.actualStorageDays) return null;
  const overDays = f.billedStorageDays - f.actualStorageDays;
  const severity: FraudSeverity = overDays >= 3 ? 'high' : 'medium';
  return {
    signalType: 'bill_to_storage_acceleration',
    severity,
    confidencePct: clampPct(55 + overDays * 8),
    payload: {
      billedStorageDays: f.billedStorageDays,
      actualStorageDays: f.actualStorageDays,
      overByDays: overDays,
    },
  };
}

/** The full detector battery, in catalog order. */
export const DETECTORS: ((f: JobFraudFacts) => DetectedSignal | null)[] = [
  detectDuplicateInvoice,
  detectExcessiveMileage,
  detectRapidResequencing,
  detectOffHoursDispatch,
  detectMissingEvidence,
  detectDriverAnomaly,
  detectCashOnlyPattern,
  detectGeofenceViolation,
  detectBillToStorageAcceleration,
];

export function runAllDetectors(facts: JobFraudFacts): DetectedSignal[] {
  const out: DetectedSignal[] = [];
  for (const detect of DETECTORS) {
    const sig = detect(facts);
    if (sig) out.push(sig);
  }
  return out;
}

// ----------------------------------------------------------------------
// Composite score
// ----------------------------------------------------------------------

export function bandForScore(score: number): FraudRiskBand {
  if (score >= BAND_THRESHOLDS.critical) return 'critical';
  if (score >= BAND_THRESHOLDS.high) return 'high';
  if (score >= BAND_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/** Points one signal contributes: weight × severity × confidence. */
export function signalPoints(sig: DetectedSignal): number {
  return (
    SIGNAL_WEIGHTS[sig.signalType] * SEVERITY_MULTIPLIER[sig.severity] * (sig.confidencePct / 100)
  );
}

export interface CompositeScore {
  score: number; // 0-100 integer
  band: FraudRiskBand;
  topSignals: FraudScoreTopSignal[];
}

/**
 * Sum weighted signal points, clamp to 0-100, bucket into a band. topSignals
 * is the contributing signals sorted by points desc (capped at 5) for the UI
 * breakdown.
 */
export function computeCompositeScore(signals: DetectedSignal[]): CompositeScore {
  const scored = signals.map((s) => ({ sig: s, points: signalPoints(s) }));
  const raw = scored.reduce((acc, x) => acc + x.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const topSignals: FraudScoreTopSignal[] = scored
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((x) => ({
      signalType: x.sig.signalType,
      severity: x.sig.severity,
      points: Number(x.points.toFixed(1)),
    }));
  return { score, band: bandForScore(score), topSignals };
}
