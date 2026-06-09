/**
 * MapsProvider — geocoding, reverse geocoding, routing/ETA, distance matrix.
 *
 * Candidates: Google Maps Platform, Mapbox, HERE. Tenants will pay their own
 * usage costs; US Tow Dispatch stays out of metering by routing requests through
 * the chosen provider with the tenant's credentials.
 */
import type { IntegrationProvider } from '../types.js';

export interface MapsCredentials {
  config: Record<string, unknown>;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  formatted: string;
  location: LatLng;
  components: Record<string, string>;
  precision: 'rooftop' | 'range_interpolated' | 'geometric_center' | 'approximate';
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  /** "fastest" honors live traffic when the provider supports it. */
  mode?: 'fastest' | 'shortest';
  departureAt?: string;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Encoded polyline or provider-specific shape token. */
  polyline?: string;
}

export interface MapsProvider extends IntegrationProvider {
  geocode(creds: MapsCredentials, query: string): Promise<GeocodeResult[]>;
  reverseGeocode(creds: MapsCredentials, location: LatLng): Promise<GeocodeResult[]>;
  route(creds: MapsCredentials, req: RouteRequest): Promise<RouteResult>;
  distanceMatrix(
    creds: MapsCredentials,
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<RouteResult[][]>;
}
