/**
 * AI Smart Dispatch (Session 41) — recommendation contract.
 *
 * recommendForJob scores every eligible (truck, driver) candidate — an active
 * driver shift with a truck and a known position — and returns the top N sorted
 * by composite score, each with its factor breakdown and a predicted ETA. The
 * result is persisted to dispatch_recommendations for the feedback loop.
 *
 * ADVISORY ONLY: nothing here assigns a job. The dispatcher still picks.
 */
import { z } from 'zod';
import { scoreFactorSchema } from './factors';

/** Scoring model identifier stamped on every persisted recommendation set. */
export const AI_DISPATCH_MODEL_VERSION = 'ai-dispatch-scoring-v1';

/** Default number of candidates surfaced (top N). */
export const DEFAULT_RECOMMENDATION_LIMIT = 3;

export const recommendationItemSchema = z.object({
  truckId: z.string().uuid(),
  truckUnit: z.string().nullable(),
  driverId: z.string().uuid(),
  driverName: z.string().nullable(),
  /** The active shift this candidate came from (position + truck binding). */
  shiftId: z.string().uuid().nullable(),
  /** Composite 0..100 (weight-normalised sum of the factors). */
  score: z.number().min(0).max(100),
  factors: z.array(scoreFactorSchema),
  predictedEtaMinutes: z.number().min(0).nullable(),
});
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;

/** The persisted recommendation set for a job (one per recompute). */
export const dispatchRecommendationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  computedAt: z.string(),
  modelVersion: z.string(),
  recommendations: z.array(recommendationItemSchema),
});
export type DispatchRecommendationDto = z.infer<typeof dispatchRecommendationSchema>;

/** Optional query for GET /ai-dispatch/jobs/:jobId/recommendations. */
export const recommendQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export type RecommendQuery = z.infer<typeof recommendQuerySchema>;
