/**
 * Region write-guard decision logic (Session 44) — PURE, no I/O.
 *
 * On a SECONDARY region we refuse tenant writes: the secondary's DB is a read
 * replica, so a write would either fail or (worse) diverge. The client is told
 * to retry against the primary via a 503 + Location header. On the PRIMARY,
 * everything is allowed.
 *
 * Read methods (GET/HEAD/OPTIONS) are always allowed — replicas serve reads.
 * A small set of operational paths is exempt regardless of method so probes,
 * metrics, region introspection, and the smoke-harness boom endpoint keep
 * working on the secondary.
 *
 * Kept pure so the rule is unit-tested without booting Fastify/Nest. The
 * Fastify onRequest hook (region.middleware.ts) is the only caller.
 */

/** HTTP methods that mutate tenant data. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Path prefixes exempt from the guard even for write methods. Liveness /
 * readiness probes, Prometheus scrape, region introspection, and the guarded
 * smoke-test boom endpoint must reach the secondary. (Most are GET and would
 * pass anyway; listing them makes the exemption explicit and method-agnostic.)
 */
export const WRITE_GUARD_EXEMPT_PREFIXES = [
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/metrics',
  '/admin/region',
  '/_debug',
] as const;

/** Seconds to advise the client to wait before retrying (Retry-After). The
 *  client should prefer the Location (primary) immediately; this covers naive
 *  clients that just retry the same URL. */
export const WRITE_REDIRECT_RETRY_AFTER_SECONDS = 1;

export type WriteGuardReason =
  | 'primary' // region is primary — never blocks
  | 'read-method' // GET/HEAD/OPTIONS — replicas serve reads
  | 'exempt-path' // operational path, always allowed
  | 'secondary-write'; // blocked: tenant write on a secondary

export interface WriteGuardInput {
  method: string;
  /** Request URL (may include a query string; it is stripped for matching). */
  url: string;
  /** True when this process is the primary region. */
  isPrimary: boolean;
}

export interface WriteGuardDecision {
  blocked: boolean;
  reason: WriteGuardReason;
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function isExempt(path: string): boolean {
  return WRITE_GUARD_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Decide whether to block a request. Order matters: primary short-circuits,
 * then read methods, then exempt paths, finally the secondary-write block.
 */
export function evaluateWriteGuard({
  method,
  url,
  isPrimary,
}: WriteGuardInput): WriteGuardDecision {
  if (isPrimary) return { blocked: false, reason: 'primary' };
  if (!WRITE_METHODS.has(method.toUpperCase())) return { blocked: false, reason: 'read-method' };
  if (isExempt(pathOf(url))) return { blocked: false, reason: 'exempt-path' };
  return { blocked: true, reason: 'secondary-write' };
}

/**
 * Build the absolute primary URL a blocked write should be retried against.
 * Returns null when the peer origin is unknown (PRIMARY_REGION_HEALTHCHECK_URL
 * unset) — the 503 is still returned, just without a Location.
 */
export function buildPrimaryLocation(peerOrigin: string, url: string): string | null {
  if (!peerOrigin) return null;
  return `${peerOrigin.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
}
