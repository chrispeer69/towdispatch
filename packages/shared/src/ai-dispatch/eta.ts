/**
 * AI Smart Dispatch (Session 41) — predictive-ETA contract.
 *
 * predictEta turns an (origin, dest, departure-time) into projected drive
 * minutes. v1 is a pure heuristic (no third-party routing call): a distance-
 * banded average speed times a time-of-day / day-of-week traffic multiplier,
 * plus an optional tenant historical-bias correction from the feedback loop.
 *
 * The provider is pluggable (EtaProvider): HeuristicEtaProvider is the default;
 * a MapboxEtaProvider stub is wired for a future server-side routing upgrade
 * and selected only when ETA_PROVIDER=mapbox AND a token is configured.
 */
import { z } from 'zod';

export const etaProviderIds = ['heuristic', 'mapbox'] as const;
export type EtaProviderId = (typeof etaProviderIds)[number];

/** Coarse traffic regime the heuristic bucketed the departure time into. */
export const etaTrafficBuckets = [
  'overnight',
  'off_peak',
  'morning_rush',
  'midday',
  'evening_rush',
  'weekend',
] as const;
export type EtaTrafficBucket = (typeof etaTrafficBuckets)[number];

export const etaBreakdownSchema = z.object({
  distanceMiles: z.number().min(0),
  /** Distance-band average speed used (mph). */
  assumedMph: z.number().positive(),
  /** Free-flow minutes before the traffic multiplier. */
  baseMinutes: z.number().min(0),
  trafficBucket: z.enum(etaTrafficBuckets),
  trafficMultiplier: z.number().positive(),
  /** Tenant historical bias applied (minutes; +late / -early). 0 when no data. */
  historicalCorrectionMinutes: z.number(),
  /** Final projected minutes (base * multiplier + correction, clamped). */
  predictedMinutes: z.number().min(0),
});
export type EtaBreakdown = z.infer<typeof etaBreakdownSchema>;

export const etaPredictionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  predictedAt: z.string(),
  originLat: z.number().nullable(),
  originLng: z.number().nullable(),
  destLat: z.number().nullable(),
  destLng: z.number().nullable(),
  /** Hour-of-day (0..23, local) the prediction was anchored to. */
  timeOfDay: z.number().int().min(0).max(23),
  /** Day-of-week, 0=Sunday .. 6=Saturday. */
  dayOfWeek: z.number().int().min(0).max(6),
  predictedMinutes: z.number().min(0),
  modelVersion: z.string(),
});
export type EtaPredictionDto = z.infer<typeof etaPredictionSchema>;

/** Response of GET /ai-dispatch/jobs/:jobId/eta. */
export const etaResultSchema = z.object({
  jobId: z.string().uuid(),
  provider: z.enum(etaProviderIds),
  modelVersion: z.string(),
  predictedMinutes: z.number().min(0).nullable(),
  breakdown: etaBreakdownSchema.nullable(),
});
export type EtaResultDto = z.infer<typeof etaResultSchema>;
