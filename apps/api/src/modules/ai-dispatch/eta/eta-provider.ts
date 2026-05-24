/**
 * AI Smart Dispatch (Session 41) — pluggable ETA provider contract.
 *
 * An EtaProvider turns an (origin, dest, departure-time) into projected drive
 * minutes. HeuristicEtaProvider (default) is a pure offline heuristic;
 * MapboxEtaProvider is a stub extension point for future server-side routing.
 * The service selects one via selectEtaProvider and falls back to the heuristic
 * if the configured provider throws.
 */
import type { EtaBreakdown, EtaProviderId } from '@ustowdispatch/shared';

export interface EtaPredictInput {
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  /** Departure instant; drives the time-of-day / day-of-week traffic factor. */
  departureTime: Date;
  /** Tenant historical signed ETA bias (minutes; + = systematically late). */
  historicalBiasMinutes?: number;
}

export interface EtaPredictResult {
  /** Null when origin or dest position is unknown. */
  predictedMinutes: number | null;
  breakdown: EtaBreakdown | null;
}

export interface EtaProvider {
  readonly id: EtaProviderId;
  readonly modelVersion: string;
  predict(input: EtaPredictInput): EtaPredictResult;
}
