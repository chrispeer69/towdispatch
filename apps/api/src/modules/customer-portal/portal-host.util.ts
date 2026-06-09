/**
 * Pure Host-header parsing helpers for portal tenant resolution (Session 32).
 * Kept dependency-free so they're unit-testable without a database.
 */

/** Lowercase, strip a trailing port, drop a leading "www.". */
export function normalizeHost(raw: string): string {
  const h = raw.trim().toLowerCase();
  if (!h) return '';
  const noPort = h.split(':')[0] ?? '';
  return noPort.startsWith('www.') ? noPort.slice(4) : noPort;
}

/**
 * Given a normalized host and the portal apex (e.g. "portal.ustowdispatch.cloud"),
 * return the single-label slug for "<slug>.<base>", or null. Rejects multi-
 * label prefixes so a.b.portal.<base> doesn't masquerade as slug "a.b".
 */
export function extractSubdomainSlug(host: string, baseDomain: string): string | null {
  const base = baseDomain.toLowerCase();
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!slug || slug.includes('.')) return null;
  return slug;
}

/**
 * Build a portal link back to the same host the request arrived on, so email
 * verification / reset links land on the tenant's branded portal. http for
 * localhost dev, https otherwise; preserves the dev port.
 */
export function buildPortalUrl(rawHost: string, path: string, token: string): string {
  const host = rawHost.trim().toLowerCase();
  const bareHost = host.split(':')[0] ?? host;
  const isLocal =
    bareHost === 'localhost' || bareHost.startsWith('127.') || bareHost.endsWith('.local');
  const scheme = isLocal ? 'http' : 'https';
  return `${scheme}://${host}${path}?token=${encodeURIComponent(token)}`;
}
