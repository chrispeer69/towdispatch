/**
 * AI Smart Dispatch (Session 41) — scoring-factor contract.
 *
 * The recommendation engine scores each (truck, driver) candidate for a job on
 * six weighted factors, each normalised to 0..100. The composite score is the
 * weight-normalised sum. Weights are operator-tunable defaults (env-overridable
 * — see config.schema.ts AI_DISPATCH_WEIGHT_*); per-tenant overrides are a
 * documented deferral. See SESSION_41_DECISIONS.md.
 *
 * ADVISORY ONLY: the engine recommends; it never auto-assigns a job.
 */
import { z } from 'zod';

export const dispatchFactorKeys = [
  // Straight-line proximity of the truck's last-known position to the pickup.
  'distance',
  // Equipment / class match for the job's service type (HD, EV, flatbed…).
  'capability',
  // Driver holds the certifications the job legally / safely requires.
  'cert_match',
  // Driver fatigue — hours on shift in the last 24h (lower hours score higher).
  'fatigue',
  // Driver's historical ETA accuracy on similar jobs (from the feedback loop).
  'historical_performance',
  // Load balancing — drivers under the tenant's weekly completion average
  // score higher so work spreads across the roster.
  'utilization_balance',
] as const;
export type DispatchFactorKey = (typeof dispatchFactorKeys)[number];

/**
 * Default factor weights as integer "points". The engine normalises by the sum
 * (so they need not total 100). Rationale (SESSION_41_DECISIONS.md):
 *   distance 30   — response time is the headline dispatch metric.
 *   capability 25 — a truck that physically can't do the job is useless.
 *   cert_match 15 — legal/safety gate; high but below physical capability.
 *   fatigue 10    — safety nudge; most drivers are within HOS so it rarely bites.
 *   historical 10 — data-driven, deliberately low until the feedback loop fills.
 *   utilization 10— fairness / spreading load; a tie-breaker, not a driver.
 */
export const DEFAULT_FACTOR_WEIGHTS: Record<DispatchFactorKey, number> = {
  distance: 30,
  capability: 25,
  cert_match: 15,
  fatigue: 10,
  historical_performance: 10,
  utilization_balance: 10,
};

export type DispatchWeights = Record<DispatchFactorKey, number>;

export const scoreFactorSchema = z.object({
  key: z.enum(dispatchFactorKeys),
  /** Raw factor score, 0..100. */
  score: z.number().min(0).max(100),
  /** Normalised weight, 0..1 (sums to 1 across all factors). */
  weight: z.number().min(0).max(1),
  /** score * weight — this factor's contribution to the composite. */
  weightedContribution: z.number(),
  /** Human-readable one-liner explaining the score (shown in the UI breakdown). */
  detail: z.string(),
});
export type ScoreFactor = z.infer<typeof scoreFactorSchema>;
