/**
 * Public Marketplace API (Session 46) — OAuth2 scope catalog.
 *
 * Scopes are the granular, per-resource permissions a tenant operator grants
 * to a third-party app at install time. They mirror the resource surface a
 * future public REST API (Session 29) will expose; the catalog lives here so
 * both the OAuth issuance path and the per-request `MarketplaceTokenGuard`
 * read from a single source of truth (same pattern as the role catalog).
 *
 * An access token is scoped to (tenant_id, app_id, scopes_granted) and can
 * NEVER exceed the scopes the app itself declares, nor the scopes the
 * installing operator approved. See SESSION_46_DECISIONS.md.
 *
 * Naming: `<action>:<resource>` — `read` is non-mutating, `write` implies the
 * matching read. Never rename a shipped scope; only add.
 */

export const MARKETPLACE_SCOPES = [
  'read:profile',
  'read:jobs',
  'write:jobs',
  'read:invoices',
  'write:invoices',
  'read:customers',
  'write:customers',
  'read:vehicles',
  'read:fleet',
  'read:impound',
  'read:webhooks',
] as const;

export type MarketplaceScope = (typeof MARKETPLACE_SCOPES)[number];

/** Human-readable descriptions surfaced on the install consent screen. */
export const MARKETPLACE_SCOPE_DESCRIPTIONS: Record<MarketplaceScope, string> = {
  'read:profile': 'Read your company name and basic account profile.',
  'read:jobs': 'View jobs, statuses, and dispatch details.',
  'write:jobs': 'Create and update jobs on your behalf.',
  'read:invoices': 'View invoices and billing line items.',
  'write:invoices': 'Create and update invoices on your behalf.',
  'read:customers': 'View customer records and contacts.',
  'write:customers': 'Create and update customer records.',
  'read:vehicles': 'View vehicle records attached to jobs and impounds.',
  'read:fleet': 'View trucks, drivers, and shift status.',
  'read:impound': 'View impound lot inventory and lien status.',
  'read:webhooks': 'View the webhook subscriptions configured for this app.',
};

const SCOPE_SET: ReadonlySet<string> = new Set(MARKETPLACE_SCOPES);

/** Type guard: is `value` a known, currently-supported scope? */
export const isMarketplaceScope = (value: string): value is MarketplaceScope =>
  SCOPE_SET.has(value);

/**
 * Returns the subset of `requested` that are not valid scopes. Empty array =>
 * every requested scope is known. Callers reject the request when non-empty.
 */
export const unknownScopes = (requested: readonly string[]): string[] =>
  requested.filter((s) => !SCOPE_SET.has(s));

/**
 * True when every scope in `subset` is also present in `superset`. Used twice:
 *   1. an install can't grant scopes the app didn't declare, and
 *   2. a token request (or refresh) can't widen beyond what was granted.
 * De-duplication is the caller's concern; this is a pure containment check.
 */
export const scopesContained = (
  subset: readonly string[],
  superset: readonly string[],
): boolean => {
  const allow = new Set(superset);
  return subset.every((s) => allow.has(s));
};

/**
 * Normalizes a space-delimited OAuth `scope` string (RFC 6749 §3.3) into a
 * de-duplicated, order-stable array. Unknown tokens are preserved so the
 * caller can surface `invalid_scope` rather than silently dropping them.
 */
export const parseScopeString = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/\s+/)) {
    if (tok.length === 0 || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
};

/** Serializes scopes back to the space-delimited wire form. */
export const formatScopeString = (scopes: readonly string[]): string => scopes.join(' ');
