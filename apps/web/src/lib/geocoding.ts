/**
 * Lightweight geocoding helpers used by the call-intake form to convert a
 * typed pickup / dropoff address into lat/lng and to compute the inline
 * "X.X mi from office" hints.
 *
 * We hit Mapbox Forward Geocoding directly from the browser using the
 * NEXT_PUBLIC_MAPBOX_TOKEN that's already exposed for the dispatch map. No
 * server round-trip — the token is public, cached by the CDN, and rate
 * limits are tenant-wide rather than per-user. If the token is missing or
 * still set to the placeholder, geocoding silently degrades to "no coords"
 * and the distance hints disappear; the form continues to function with
 * manual lat/lng entry.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const PLACEHOLDER_TOKEN_PREFIX = 'pk.placeholder';

export function isUsableMapboxToken(token: string | null | undefined): token is string {
  if (!token) return false;
  if (token.startsWith(PLACEHOLDER_TOKEN_PREFIX)) return false;
  return true;
}

/**
 * Forward-geocode a free-text address. Returns the best match (first result)
 * or null if nothing parsed. Country-biased to the US since this is a US-only
 * dispatch product; loosen later if we expand.
 */
export async function geocodeAddress(
  query: string,
  token: string,
  signal?: AbortSignal,
): Promise<LatLng | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (!isUsableMapboxToken(token)) return null;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json` +
    `?access_token=${encodeURIComponent(token)}&country=us&limit=1&autocomplete=false`;
  try {
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) return null;
    const body = (await res.json()) as {
      features?: Array<{ center?: [number, number] }>;
    };
    const feat = body.features?.[0];
    const center = feat?.center;
    if (!center || center.length < 2) return null;
    const [lng, lat] = center;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Great-circle distance in statute miles between two points. Good enough for
 * the dispatcher's at-a-glance hint — driving distance is a different number
 * and lives inside the rate engine, not here.
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const earthRadiusMiles = 3958.7613;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return '< 0.1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
