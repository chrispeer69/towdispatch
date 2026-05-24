/**
 * Fraud Detection (Session 43) — scoring configuration.
 *
 * The single source of truth for the v1 heuristic model: per-signal base
 * weights, severity multipliers, risk-band thresholds, and the per-detector
 * trigger thresholds. computeCompositeScore + the detectors read everything
 * from here so tuning is one edit. The rationale for each weight is in
 * SESSION_43_DECISIONS.md.
 *
 * A signal contributes:
 *   points = SIGNAL_WEIGHTS[type] × SEVERITY_MULTIPLIER[severity] × confidence
 * summed across signals and clamped to 0-100. Heuristic, not trained — a
 * future session swaps MODEL_VERSION + these tables for a fitted model.
 */
import type { FraudSeverity, FraudSignalType } from '@ustowdispatch/shared';

export const MODEL_VERSION = 'fraud-v1.0';

/**
 * Base points each signal contributes at full (high) severity and 100%
 * confidence. Fraud-grade signals (double billing, billing for service not
 * rendered, storage padding) weigh heaviest; context flags (off-hours,
 * driver volume) weigh least.
 */
export const SIGNAL_WEIGHTS: Record<FraudSignalType, number> = {
  // Double billing the same vehicle to the same club — the canonical fraud.
  duplicate_invoice: 45,
  // Drop-off far from the billed address ⇒ billing for service not rendered.
  geofence_violation: 40,
  // Storage days billed beyond the actual gap ⇒ direct overbilling.
  bill_to_storage_acceleration: 40,
  // Mileage padding — billed miles materially exceed the geocoded route.
  excessive_mileage: 30,
  // Thin documentation on a high-value invoice ⇒ high dispute-loss exposure.
  missing_evidence: 25,
  // Lifecycle thrash — status flipped repeatedly, a manipulation tell.
  rapid_resequencing: 20,
  // Revenue-leakage / off-books pattern across a customer's cash jobs.
  cash_only_pattern: 20,
  // Volume outlier — a driver far above their own baseline.
  driver_anomaly: 20,
  // Lowest-signal context flag; corroborates, rarely stands alone.
  off_hours_dispatch: 15,
};

export const SEVERITY_MULTIPLIER: Record<FraudSeverity, number> = {
  info: 0,
  low: 0.4,
  medium: 0.7,
  high: 1.0,
};

/**
 * Inclusive lower bounds. score <30 = low, 30-59 = medium, 60-79 = high,
 * 80+ = critical. Matches the spec.
 */
export const BAND_THRESHOLDS = {
  medium: 30,
  high: 60,
  critical: 80,
} as const;

// ----------------------------------------------------------------------
// Per-detector trigger thresholds
// ----------------------------------------------------------------------

/** duplicate_invoice — sibling within ±N days of this job. */
export const DUPLICATE_WINDOW_DAYS = 2;

/** excessive_mileage — billed/geocoded ratio above which the signal fires. */
export const MILEAGE_RATIO_THRESHOLD = 1.3;

/** rapid_resequencing — back-and-forth reversal count above which it fires. */
export const RESEQUENCING_FLIP_THRESHOLD = 3;

/** missing_evidence — invoice value (cents) at/above which photos are expected. */
export const MISSING_EVIDENCE_MIN_CENTS = 50_000; // $500
export const MISSING_EVIDENCE_MIN_PHOTOS = 2;

/** off_hours_dispatch — operator hours used when a tenant has none configured. */
export const DEFAULT_OPERATOR_OPEN_HOUR = 6;
export const DEFAULT_OPERATOR_CLOSE_HOUR = 22;

/** driver_anomaly — jobs/day above (avg × this) fires. */
export const DRIVER_ANOMALY_MULTIPLIER = 2;

/** cash_only_pattern — count of cash jobs for one customer at/above which it fires. */
export const CASH_PATTERN_MIN_JOBS = 3;

/** geofence_violation — miles between billed + actual drop-off above which it fires. */
export const GEOFENCE_MAX_MILES = 5;
