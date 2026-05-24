/**
 * AI Smart Dispatch (Session 41) — HeuristicEtaProvider, PURE.
 *
 * predictEta(origin, dest, departure, ctx) → minutes. No third-party routing
 * call this session (data collection first — see SESSION_41_DECISIONS.md):
 *
 *   1. straight-line miles (haversine)
 *   2. distance-banded average speed (surface streets are slower than highway)
 *   3. time-of-day / day-of-week traffic multiplier (rush hours 1.4–1.5×)
 *   4. tenant historical-bias correction from the feedback loop (signed minutes)
 *
 * Deliberately conservative speeds: actual routing is faster on the highway,
 * slower in congestion. Good enough to rank candidates and warn a driver of an
 * unrealistic offer; swap in MapboxEtaProvider when routing is wired.
 */
import type { EtaBreakdown, EtaTrafficBucket } from '@ustowdispatch/shared';
import { haversineMiles } from '../scoring/haversine.js';
import type { EtaPredictInput, EtaPredictResult, EtaProvider } from './eta-provider.js';

export const ETA_HEURISTIC_MODEL_VERSION = 'eta-heuristic-v1';

/** Distance-banded average speeds (mph). */
export const ETA_SPEED_BANDS = {
  /** Short urban hops: lights, surface streets. */
  urbanMaxMiles: 5,
  urbanMph: 22,
  /** Suburban / arterial. */
  suburbanMaxMiles: 20,
  suburbanMph: 34,
  /** Longer runs dominated by highway. */
  highwayMph: 50,
} as const;

export function bandMph(miles: number): number {
  if (miles < ETA_SPEED_BANDS.urbanMaxMiles) return ETA_SPEED_BANDS.urbanMph;
  if (miles < ETA_SPEED_BANDS.suburbanMaxMiles) return ETA_SPEED_BANDS.suburbanMph;
  return ETA_SPEED_BANDS.highwayMph;
}

export interface TrafficFactor {
  bucket: EtaTrafficBucket;
  multiplier: number;
}

/**
 * Traffic multiplier for an hour-of-day (0..23) and day-of-week (0=Sun..6=Sat).
 * Weekday rush hours bite hardest; overnight roads are free-flowing.
 */
export function trafficFactor(hour: number, dayOfWeek: number): TrafficFactor {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend) {
    // Weekend has no commute peaks; modest midday errand traffic.
    return hour >= 10 && hour < 18
      ? { bucket: 'weekend', multiplier: 1.15 }
      : { bucket: 'weekend', multiplier: 1.05 };
  }
  if (hour >= 7 && hour < 9) return { bucket: 'morning_rush', multiplier: 1.4 };
  if (hour >= 16 && hour < 19) return { bucket: 'evening_rush', multiplier: 1.5 };
  if (hour >= 9 && hour < 16) return { bucket: 'midday', multiplier: 1.15 };
  if (hour >= 23 || hour < 5) return { bucket: 'overnight', multiplier: 0.9 };
  return { bucket: 'off_peak', multiplier: 1.05 };
}

/** Pure ETA computation shared by the provider and the unit tests. */
export function predictEtaHeuristic(input: EtaPredictInput): EtaPredictResult {
  const { originLat, originLng, destLat, destLng } = input;
  if (originLat === null || originLng === null || destLat === null || destLng === null) {
    return { predictedMinutes: null, breakdown: null };
  }
  const miles = haversineMiles(originLat, originLng, destLat, destLng);
  const assumedMph = bandMph(miles);
  const baseMinutes = (miles / assumedMph) * 60;
  const { bucket, multiplier } = trafficFactor(
    input.departureTime.getHours(),
    input.departureTime.getDay(),
  );
  const correction = input.historicalBiasMinutes ?? 0;
  const predicted = Math.max(0, baseMinutes * multiplier + correction);

  const breakdown: EtaBreakdown = {
    distanceMiles: round1(miles),
    assumedMph,
    baseMinutes: round1(baseMinutes),
    trafficBucket: bucket,
    trafficMultiplier: multiplier,
    historicalCorrectionMinutes: round1(correction),
    predictedMinutes: Math.round(predicted),
  };
  return { predictedMinutes: Math.round(predicted), breakdown };
}

export class HeuristicEtaProvider implements EtaProvider {
  readonly id = 'heuristic' as const;
  readonly modelVersion = ETA_HEURISTIC_MODEL_VERSION;

  predict(input: EtaPredictInput): EtaPredictResult {
    return predictEtaHeuristic(input);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
