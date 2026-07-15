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
 * The graceful degradation above is deliberate, but a Mapbox-side failure
 * (revoked token, URL restriction, 401/403/429) used to be COMPLETELY
 * invisible — the address helpers just stopped suggesting, with nothing in
 * the console to diagnose. Warn once per page load so "geocoding is broken"
 * is a five-second console check instead of an archaeology dig.
 */
let warnedGeocodingFailure = false;
function warnGeocodingFailure(status: number): void {
  if (warnedGeocodingFailure) return;
  warnedGeocodingFailure = true;
  console.warn(
    `Mapbox geocoding request failed with HTTP ${status}. Address autocomplete and distance hints are disabled. Check that NEXT_PUBLIC_MAPBOX_TOKEN is a valid public token (Mapbox account → Access tokens) and that its URL restrictions allow this domain. 401/403 = bad or restricted token; 429 = rate limited.`,
  );
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
    if (!res.ok) {
      warnGeocodingFailure(res.status);
      return null;
    }
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

/**
 * Address suggestion for the autocomplete dropdown. Captures the structured
 * address components plus the lat/lng so the caller can use them directly
 * (no second geocode round-trip needed).
 */
export interface AddressSuggestion {
  /** Human-readable full address: "2346 Main St, Columbus, OH 43210" */
  fullAddress: string;
  /** Just the place-name component for terse rendering: "2346 Main St" */
  placeName: string;
  /** City + region context: "Columbus, Ohio 43210" */
  context: string;
  lat: number;
  lng: number;
  /** Mapbox feature id for tracking; can be sent back to the API for analytics */
  mapboxId: string;
}

/**
 * Address autocomplete via the Mapbox Forward Geocoding API. Returns up to
 * `limit` ranked suggestions for the typed query. Country-biased to US; if
 * `proximity` is supplied (e.g., the operator's primary yard lat/lng), the
 * API ranks nearby matches higher. Cancellable via signal.
 *
 * Cost note: Mapbox bills geocoding by *session*, not by request. A rapid
 * sequence of typeahead calls from one user counts as one session as long
 * as the user picks a result within ~60 seconds. Debounce on the caller
 * side to keep API volume low.
 */
export async function searchAddresses(
  query: string,
  token: string,
  options: { limit?: number; signal?: AbortSignal; proximity?: LatLng } = {},
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  if (!isUsableMapboxToken(token)) return [];
  const limit = options.limit ?? 5;
  let url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json` +
    `?access_token=${encodeURIComponent(token)}&country=us&limit=${limit}&autocomplete=true&types=address,place,postcode`;
  if (options.proximity) {
    url += `&proximity=${options.proximity.lng},${options.proximity.lat}`;
  }
  try {
    const res = await fetch(url, options.signal ? { signal: options.signal } : {});
    if (!res.ok) {
      warnGeocodingFailure(res.status);
      return [];
    }
    const body = (await res.json()) as {
      features?: Array<{
        id?: string;
        place_name?: string;
        text?: string;
        center?: [number, number];
        context?: Array<{ text?: string }>;
      }>;
    };
    const features = body.features ?? [];
    const out: AddressSuggestion[] = [];
    for (const f of features) {
      const center = f.center;
      if (!center || center.length < 2) continue;
      const [lng, lat] = center;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const fullAddress = f.place_name ?? '';
      const placeName = f.text ?? fullAddress;
      const context = (f.context ?? [])
        .map((c) => c.text)
        .filter((s): s is string => Boolean(s))
        .join(', ');
      out.push({
        fullAddress,
        placeName,
        context,
        lat,
        lng,
        mapboxId: f.id ?? '',
      });
    }
    return out;
  } catch {
    return [];
  }
}
