/**
 * MapsProvider — the cross-app interface for geocoding, reverse geocoding,
 * and route distance/duration. The web app's Mapbox-backed map pane and any
 * future server-side route planner both program against this contract so a
 * tenant could swap Mapbox for Google or HERE without changing call sites.
 *
 * The runtime implementation lives in apps/api/src/integrations/maps for the
 * server-side concerns (audited, idempotent) and in apps/web/src/lib/maps
 * for the client-side Mapbox GL JS rendering. This package only exposes the
 * shape both sides agree on.
 */
import { z } from 'zod';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const geocodePrecisionValues = [
  'rooftop',
  'range_interpolated',
  'geometric_center',
  'approximate',
] as const;
export type GeocodePrecision = (typeof geocodePrecisionValues)[number];

export const geocodeResultSchema = z.object({
  formatted: z.string(),
  location: latLngSchema,
  components: z.record(z.string()),
  precision: z.enum(geocodePrecisionValues),
});
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export const routeRequestSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  waypoints: z.array(latLngSchema).optional(),
  mode: z.enum(['fastest', 'shortest']).optional(),
  departureAt: z.string().datetime().optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const routeResultSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  polyline: z.string().optional(),
});
export type RouteResult = z.infer<typeof routeResultSchema>;

export interface MapsCredentials {
  config: Record<string, unknown>;
}

/**
 * The cross-app provider contract. Implementations are registered in the
 * IntegrationRegistry server-side; the web client uses a thinner subset
 * (geocoding/markers) that maps to Mapbox GL JS directly.
 */
export interface MapsProvider {
  readonly id: string;
  readonly displayName: string;
  geocode(creds: MapsCredentials, query: string): Promise<GeocodeResult[]>;
  reverseGeocode(creds: MapsCredentials, location: LatLng): Promise<GeocodeResult[]>;
  route(creds: MapsCredentials, req: RouteRequest): Promise<RouteResult>;
  distanceMatrix(
    creds: MapsCredentials,
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<RouteResult[][]>;
}
