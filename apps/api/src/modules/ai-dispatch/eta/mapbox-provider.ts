/**
 * AI Smart Dispatch (Session 41) — MapboxEtaProvider STUB.
 *
 * Extension point for a future server-side routing upgrade (Mapbox Directions /
 * Google Routes). Intentionally NOT implemented this session — v1 is heuristic-
 * only (no third-party routing calls; see SESSION_41_DECISIONS.md). It is wired
 * so the provider seam is exercised; selectEtaProvider only returns it when
 * ETA_PROVIDER=mapbox AND a token is set, and the service falls back to the
 * heuristic if predict() throws. Implementing predict() is a documented
 * deferral (real-time traffic API).
 */
import type { EtaPredictInput, EtaPredictResult, EtaProvider } from './eta-provider.js';

export const ETA_MAPBOX_MODEL_VERSION = 'eta-mapbox-v1';

export class MapboxEtaProvider implements EtaProvider {
  readonly id = 'mapbox' as const;
  readonly modelVersion = ETA_MAPBOX_MODEL_VERSION;

  // Token retained for the future Directions API impl; unused by the stub.
  constructor(private readonly accessToken: string) {
    void this.accessToken;
  }

  // _input is the contract a future Directions-API impl will consume; the
  // leading underscore marks it intentionally unused by the stub.
  predict(_input: EtaPredictInput): EtaPredictResult {
    throw new Error(
      'MapboxEtaProvider is not implemented — server-side routing is a future session. ' +
        'Set ETA_PROVIDER=heuristic (the default).',
    );
  }
}
