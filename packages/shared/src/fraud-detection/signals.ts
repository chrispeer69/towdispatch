/**
 * Fraud Detection (Session 43) — risk-signal contracts.
 *
 * Mirrors the fraud_risk_signals Drizzle schema + the pure detector catalog.
 * Timestamps cross the wire as ISO-8601 strings. The enums mirror the DB
 * CHECK constraints; the API's pure detectors import these as their source of
 * truth so the catalog never drifts between layers.
 */
import { z } from 'zod';

// ----------------------------------------------------------------------
// Catalog (mirrors the DB CHECK constraints)
// ----------------------------------------------------------------------

export const fraudSignalTypeValues = [
  'duplicate_invoice',
  'excessive_mileage',
  'rapid_resequencing',
  'off_hours_dispatch',
  'missing_evidence',
  'driver_anomaly',
  'cash_only_pattern',
  'geofence_violation',
  'bill_to_storage_acceleration',
] as const;
export type FraudSignalType = (typeof fraudSignalTypeValues)[number];

export const fraudSeverityValues = ['info', 'low', 'medium', 'high'] as const;
export type FraudSeverity = (typeof fraudSeverityValues)[number];

/** Human-readable label + one-line description per signal — used by the UI. */
export const FRAUD_SIGNAL_LABELS: Record<FraudSignalType, { label: string; description: string }> =
  {
    duplicate_invoice: {
      label: 'Duplicate invoice',
      description: 'Same VIN + motor club billed within a 2-day window.',
    },
    excessive_mileage: {
      label: 'Excessive mileage',
      description: 'Billed miles exceed the geocoded distance by more than 30%.',
    },
    rapid_resequencing: {
      label: 'Rapid resequencing',
      description: 'Job status flipped back-and-forth more than 3 times.',
    },
    off_hours_dispatch: {
      label: 'Off-hours dispatch',
      description: "Dispatched outside the operator's stated hours without an after-hours flag.",
    },
    missing_evidence: {
      label: 'Missing evidence',
      description: 'High-value invoice with fewer than 2 evidence photos.',
    },
    driver_anomaly: {
      label: 'Driver volume anomaly',
      description: 'Driver completed more than 2× their 30-day average jobs/day.',
    },
    cash_only_pattern: {
      label: 'Cash-only pattern',
      description: 'Same customer name across multiple cash-paid jobs.',
    },
    geofence_violation: {
      label: 'Geofence violation',
      description: 'Actual drop-off more than 5 miles from the billed drop-off address.',
    },
    bill_to_storage_acceleration: {
      label: 'Storage acceleration',
      description: 'Storage days billed exceed the actual gap on the impound record.',
    },
  };

// ----------------------------------------------------------------------
// DTO
// ----------------------------------------------------------------------

export const fraudRiskSignalSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  signalType: z.enum(fraudSignalTypeValues),
  severity: z.enum(fraudSeverityValues),
  confidencePct: z.number().int().min(0).max(100),
  detectedAt: z.string().datetime(),
  payload: z.record(z.unknown()),
  modelVersion: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type FraudRiskSignalDto = z.infer<typeof fraudRiskSignalSchema>;
