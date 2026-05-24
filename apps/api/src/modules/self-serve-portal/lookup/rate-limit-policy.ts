/**
 * Self-serve portal rate-limit policy (Session 55).
 *
 * Pure limit constants + key builders so the values are reviewable and unit-
 * tested; enforcement is delegated to the Redis RateLimiterService.check(key,
 * limit, ttlSeconds). Two independent limiters (SESSION_55_DECISIONS.md D9):
 *   - lookups:        5 / IP / 15 min      (abuse / scraping guard)
 *   - magic-link send: 3 / impound / hour  (anti-spam to the owner's phone)
 */
export const LOOKUP_RATE_LIMIT = 5;
export const LOOKUP_RATE_WINDOW_SECONDS = 15 * 60;

export const MAGIC_LINK_RATE_LIMIT = 3;
export const MAGIC_LINK_RATE_WINDOW_SECONDS = 60 * 60;

/** Normalize an IP so `::ffff:1.2.3.4` and `1.2.3.4` share a bucket; empty → 'unknown'. */
export function normalizeIp(ip: string | null | undefined): string {
  const v = (ip ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  return v.startsWith('::ffff:') ? v.slice('::ffff:'.length) : v;
}

export function lookupRateKey(tenantId: string, ip: string | null | undefined): string {
  return `ssp:lookup:${tenantId}:${normalizeIp(ip)}`;
}

export function magicLinkRateKey(tenantId: string, impoundId: string): string {
  return `ssp:maglink:${tenantId}:${impoundId}`;
}
