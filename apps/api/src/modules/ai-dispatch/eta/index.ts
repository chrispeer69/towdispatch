/**
 * AI Smart Dispatch (Session 41) — ETA provider selection.
 *
 * Default heuristic. Mapbox is returned only when explicitly configured AND a
 * token is present; otherwise we stay on the heuristic (the Mapbox stub throws,
 * and the service guards every predict() call with a heuristic fallback).
 */
import type { EtaProviderId } from '@ustowdispatch/shared';
import type { EtaProvider } from './eta-provider.js';
import { HeuristicEtaProvider } from './heuristic-provider.js';
import { MapboxEtaProvider } from './mapbox-provider.js';

export * from './eta-provider.js';
export * from './heuristic-provider.js';
export * from './mapbox-provider.js';

export function selectEtaProvider(opts: {
  providerId: EtaProviderId;
  mapboxToken: string;
}): EtaProvider {
  if (opts.providerId === 'mapbox' && opts.mapboxToken.length > 0) {
    return new MapboxEtaProvider(opts.mapboxToken);
  }
  return new HeuristicEtaProvider();
}
