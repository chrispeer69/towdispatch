/**
 * DirectionsService — server-side road-mile computation for job creation.
 *
 * Two providers are supported:
 *   1. Mapbox Directions API (default) — uses the existing MAPBOX_ACCESS_TOKEN
 *      env var. Server-side keeps the token off the wire.
 *   2. Google Routes API — toggled per tenant via tenants.settings.useGoogleForDistance.
 *      Requires GOOGLE_ROUTES_API_KEY; otherwise falls back to Mapbox with a warning.
 *
 * The service is stateless and best-effort: if either provider returns
 * an error or times out, we fall through to Haversine straight-line
 * distance × 1.3 (a reasonable estimate of the road-detour factor for
 * urban driving). The job creation flow never blocks on a 5xx from the
 * provider — the operator can still create the job, miles are populated
 * with the best-effort estimate, and the operator can edit later.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadMilesResult {
  miles: number;
  /** Which provider produced the answer. */
  provider: 'mapbox' | 'google' | 'haversine_estimate';
}

@Injectable()
export class DirectionsService {
  private readonly logger = new Logger(DirectionsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Compute road miles between two lat/lng points. Returns a numeric value
   * with provider provenance for audit.
   *
   * @param useGoogle Pass true if the tenant has the Google Routes flag set.
   *                  Falls back to Mapbox if the Google key isn't configured.
   */
  async roadMiles(origin: LatLng, dest: LatLng, useGoogle = false): Promise<RoadMilesResult> {
    if (useGoogle) {
      const googleKey = process.env.GOOGLE_ROUTES_API_KEY ?? '';
      if (googleKey) {
        const r = await this.googleRoadMiles(origin, dest, googleKey);
        if (r !== null) return { miles: r, provider: 'google' };
      }
    }
    const mapboxToken = this.config.mapboxAccessToken;
    if (mapboxToken) {
      const r = await this.mapboxRoadMiles(origin, dest, mapboxToken);
      if (r !== null) return { miles: r, provider: 'mapbox' };
    }
    // Best-effort fallback when both providers are unreachable.
    return {
      miles: haversineMiles(origin, dest) * 1.3,
      provider: 'haversine_estimate',
    };
  }

  /**
   * Compute the two-leg distance for a job in one shot:
   *   yard → pickup (enroute) and pickup → dropoff (intow).
   * Either leg can be null when its origin/dest coordinate set is missing.
   */
  async computeJobMiles(input: {
    yardCoord?: LatLng | null;
    pickupCoord?: LatLng | null;
    dropoffCoord?: LatLng | null;
    useGoogle?: boolean;
  }): Promise<{ enrouteMiles: number | null; intowMiles: number | null }> {
    const useGoogle = input.useGoogle ?? false;
    let enrouteMiles: number | null = null;
    let intowMiles: number | null = null;
    if (input.yardCoord && input.pickupCoord) {
      const r = await this.roadMiles(input.yardCoord, input.pickupCoord, useGoogle);
      enrouteMiles = round2(r.miles);
    }
    if (input.pickupCoord && input.dropoffCoord) {
      const r = await this.roadMiles(input.pickupCoord, input.dropoffCoord, useGoogle);
      intowMiles = round2(r.miles);
    }
    return { enrouteMiles, intowMiles };
  }

  // -------- providers --------

  private async mapboxRoadMiles(
    origin: LatLng,
    dest: LatLng,
    token: string,
  ): Promise<number | null> {
    // Mapbox Directions: GET /directions/v5/{profile}/{coordinates}.json
    // Profile `driving` is fine for most light-duty work. Keep it simple.
    const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?access_token=${encodeURIComponent(token)}&geometries=geojson&overview=false`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        this.logger.warn(`Mapbox directions HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        routes?: Array<{ distance?: number }>;
      };
      const meters = body.routes?.[0]?.distance;
      if (typeof meters !== 'number') return null;
      // 1 meter = 0.000621371 statute miles
      return meters * 0.000621371;
    } catch (err) {
      this.logger.warn(`Mapbox directions failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async googleRoadMiles(
    origin: LatLng,
    dest: LatLng,
    apiKey: string,
  ): Promise<number | null> {
    // Google Routes API v2: POST /directions/v2:computeRoutes
    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`Google routes HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as {
        routes?: Array<{ distanceMeters?: number }>;
      };
      const meters = data.routes?.[0]?.distanceMeters;
      if (typeof meters !== 'number') return null;
      return meters * 0.000621371;
    } catch (err) {
      this.logger.warn(`Google routes failed: ${(err as Error).message}`);
      return null;
    }
  }
}

// -------- helpers --------

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.7613;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
