/**
 * AI Smart Dispatch (Session 41) — accuracy report contracts.
 *
 * Three operator-facing measures, all derived from dispatch_outcomes:
 *   - recommendation accuracy : how often the dispatcher picked the engine's #1
 *   - ETA accuracy            : mean absolute error of the predicted ETA
 *   - per-driver performance  : avg ETA error + completion volume, ranked
 *
 * Served from GET /ai-dispatch/reports/* (NOT the reporting rollup module).
 */
import { z } from 'zod';

export const recommendationAccuracyReportSchema = z.object({
  windowDays: z.number().int().positive(),
  totalOutcomes: z.number().int().min(0),
  /** Outcomes that had a recommendation to compare against. */
  outcomesWithRecommendation: z.number().int().min(0),
  /** Of those, how many picked the engine's #1 candidate. */
  topOnePicked: z.number().int().min(0),
  /** topOnePicked / outcomesWithRecommendation, 0..100. Null when denominator 0. */
  topOneAccuracyPct: z.number().min(0).max(100).nullable(),
});
export type RecommendationAccuracyReport = z.infer<typeof recommendationAccuracyReportSchema>;

export const etaAccuracyReportSchema = z.object({
  windowDays: z.number().int().positive(),
  /** Outcomes carrying both a predicted and an actual ETA. */
  samples: z.number().int().min(0),
  /** mean(|actual - predicted|), minutes. Null when no samples. */
  meanAbsoluteErrorMinutes: z.number().min(0).nullable(),
  /** mean(actual - predicted), minutes (signed bias: + = systematically late). */
  meanBiasMinutes: z.number().nullable(),
});
export type EtaAccuracyReport = z.infer<typeof etaAccuracyReportSchema>;

export const driverPerformanceRankSchema = z.object({
  driverId: z.string().uuid(),
  driverName: z.string().nullable(),
  completedJobs: z.number().int().min(0),
  /** mean(|actual - predicted|) for this driver, minutes. Null when no samples. */
  avgEtaErrorMinutes: z.number().min(0).nullable(),
  /** 1-based rank (best ETA accuracy first; drivers with no samples sort last). */
  rank: z.number().int().positive(),
});
export type DriverPerformanceRank = z.infer<typeof driverPerformanceRankSchema>;

export const driverPerformanceReportSchema = z.object({
  windowDays: z.number().int().positive(),
  drivers: z.array(driverPerformanceRankSchema),
});
export type DriverPerformanceReport = z.infer<typeof driverPerformanceReportSchema>;
