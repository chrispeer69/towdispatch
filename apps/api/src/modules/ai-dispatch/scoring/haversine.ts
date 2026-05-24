/**
 * AI Smart Dispatch (Session 41) — great-circle distance, PURE.
 *
 * Same earth radius (miles) and formula as the dashboard ETA board
 * (dashboard.service.ts) so the two surfaces never disagree on a distance.
 */

const EARTH_RADIUS_MILES = 3958.7613;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Straight-line miles between two lat/lng points. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Parse a numeric/text coordinate column to a finite number, or null. */
export function coord(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
