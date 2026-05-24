/**
 * AI Smart Dispatch (Session 41) — feedback-loop contract.
 *
 * When a dispatcher actually assigns (and the job later completes), the chosen
 * truck/driver + the realised ETA are recorded against the recommendation that
 * was live at the time. was_top_recommendation captures whether the dispatcher
 * picked the engine's #1, and eta_error_minutes feeds ETA-accuracy reporting
 * and the per-tenant historical-bias correction. This is how a future ML model
 * gets trained — v1 only collects.
 */
import { z } from 'zod';

export const recordOutcomeSchema = z.object({
  /** Recommendation set this outcome is measured against. Null when the
   *  dispatcher assigned before any recommendation was computed. */
  recommendationId: z.string().uuid().nullable().optional(),
  chosenTruckId: z.string().uuid(),
  chosenDriverId: z.string().uuid(),
  /** Realised drive-to-scene minutes, once known. Null at assignment time. */
  actualEtaMinutes: z.number().min(0).nullable().optional(),
  /** ISO-8601 UTC; defaults to now() server-side when omitted. */
  completedAt: z.string().optional(),
});
export type RecordOutcomePayload = z.infer<typeof recordOutcomeSchema>;

export const dispatchOutcomeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  recommendationId: z.string().uuid().nullable(),
  chosenTruckId: z.string().uuid(),
  chosenDriverId: z.string().uuid(),
  wasTopRecommendation: z.boolean(),
  predictedEtaMinutes: z.number().min(0).nullable(),
  actualEtaMinutes: z.number().min(0).nullable(),
  /** actual - predicted; positive = arrived later than predicted. */
  etaErrorMinutes: z.number().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DispatchOutcomeDto = z.infer<typeof dispatchOutcomeSchema>;
