/**
 * AI Smart Dispatch (Session 41) — composite candidate scoring, PURE.
 *
 * scoreCandidate runs the six factors, normalises the operator weights to sum
 * to 1, and returns the weighted composite (0..100) plus the per-factor
 * breakdown the UI renders. The weights come from config (env-overridable
 * defaults); they need not pre-sum to anything — normalisation is internal.
 */
import {
  type DispatchFactorKey,
  type DispatchWeights,
  type ScoreFactor,
  dispatchFactorKeys,
} from '@ustowdispatch/shared';
import {
  type CapabilityFacts,
  type CertFacts,
  type DistanceFacts,
  type FactorResult,
  capabilityScore,
  certMatchScore,
  distanceScore,
  fatigueScore,
  historicalPerformanceScore,
  utilizationBalanceScore,
} from './factors.js';

export interface ScoreCandidateInput {
  weights: DispatchWeights;
  distance: DistanceFacts;
  capability: CapabilityFacts;
  cert: CertFacts;
  fatigueHours: number;
  historicalAvgAbsErrorMinutes: number | null;
  utilization: { driverCompletedThisWeek: number; tenantAvgCompletedThisWeek: number };
}

export interface CandidateScoreResult {
  /** Weighted composite, 0..100, rounded to one decimal. */
  score: number;
  factors: ScoreFactor[];
}

/** Normalise raw weights to sum to 1. All-zero (or negative) → equal weights. */
export function normalizeWeights(weights: DispatchWeights): Record<DispatchFactorKey, number> {
  const safe = dispatchFactorKeys.map((k) => Math.max(0, weights[k] ?? 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const out = {} as Record<DispatchFactorKey, number>;
  dispatchFactorKeys.forEach((k, i) => {
    out[k] = sum > 0 ? (safe[i] as number) / sum : 1 / dispatchFactorKeys.length;
  });
  return out;
}

export function scoreCandidate(input: ScoreCandidateInput): CandidateScoreResult {
  const norm = normalizeWeights(input.weights);

  const raw: Record<DispatchFactorKey, FactorResult> = {
    distance: distanceScore(input.distance),
    capability: capabilityScore(input.capability),
    cert_match: certMatchScore(input.cert),
    fatigue: fatigueScore(input.fatigueHours),
    historical_performance: historicalPerformanceScore(input.historicalAvgAbsErrorMinutes),
    utilization_balance: utilizationBalanceScore(
      input.utilization.driverCompletedThisWeek,
      input.utilization.tenantAvgCompletedThisWeek,
    ),
  };

  let composite = 0;
  const factors: ScoreFactor[] = dispatchFactorKeys.map((key) => {
    const r = raw[key];
    const weight = norm[key];
    const weightedContribution = r.score * weight;
    composite += weightedContribution;
    return {
      key,
      score: round1(r.score),
      weight: round4(weight),
      weightedContribution: round1(weightedContribution),
      detail: r.detail,
    };
  });

  return { score: round1(composite), factors };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
