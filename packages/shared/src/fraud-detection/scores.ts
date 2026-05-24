/**
 * Fraud Detection (Session 43) — composite-score contracts.
 *
 * Mirrors the fraud_risk_scores Drizzle schema. score_0_100 is bucketed into
 * a risk_band by the documented thresholds (low <30, medium 30-59, high
 * 60-79, critical 80+ — see SESSION_43_DECISIONS.md). The review action is an
 * explicit operator decision; the module never auto-acts.
 */
import { z } from 'zod';
import { fraudSeverityValues, fraudSignalTypeValues } from './signals';

export const fraudRiskBandValues = ['low', 'medium', 'high', 'critical'] as const;
export type FraudRiskBand = (typeof fraudRiskBandValues)[number];

export const fraudReviewActionValues = ['reviewed', 'hold_invoice', 'escalate', 'cleared'] as const;
export type FraudReviewAction = (typeof fraudReviewActionValues)[number];

export const fraudScoreTopSignalSchema = z.object({
  signalType: z.enum(fraudSignalTypeValues),
  severity: z.enum(fraudSeverityValues),
  points: z.number(),
});
export type FraudScoreTopSignal = z.infer<typeof fraudScoreTopSignalSchema>;

export const fraudRiskScoreSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  score0100: z.number().int().min(0).max(100),
  riskBand: z.enum(fraudRiskBandValues),
  computedAt: z.string().datetime(),
  topSignals: z.array(fraudScoreTopSignalSchema),
  modelVersion: z.string(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewAction: z.enum(fraudReviewActionValues).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type FraudRiskScoreDto = z.infer<typeof fraudRiskScoreSchema>;

// ----------------------------------------------------------------------
// Payloads
// ----------------------------------------------------------------------

/** Record an explicit operator decision on a scored job. */
export const reviewFraudScoreSchema = z
  .object({
    reviewAction: z.enum(fraudReviewActionValues),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type ReviewFraudScorePayload = z.infer<typeof reviewFraudScoreSchema>;

export const listHighRiskFilterSchema = z
  .object({
    band: z.enum(fraudRiskBandValues).optional(),
    // Lookback window in days for the queue (default 30 in the service).
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict();
export type ListHighRiskFilter = z.infer<typeof listHighRiskFilterSchema>;
