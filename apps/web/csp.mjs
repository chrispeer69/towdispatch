/**
 * Content-Security-Policy builder for the web frontend (R-12).
 *
 * Mirrors the API's Helmet directives (apps/api/src/main.ts) and tightens
 * script handling for our own bundles. Pure function so the policy can be
 * unit-tested.
 *
 * The connect-src API origin is derived from NEXT_PUBLIC_API_URL (plus its
 * websocket scheme for Socket.IO) so the policy is correct in every
 * environment — local dev (http://localhost:3001 + ws://) included — without
 * a hardcoded list per env.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string} a single CSP header value
 */
export function buildCsp(env) {
  const connectExtra = new Set();
  const apiUrl = env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      connectExtra.add(u.origin);
      connectExtra.add(`${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`);
    } catch {
      // Malformed URL — the env-guard already rejects the missing case; a bad
      // value just means no derived origin (still covered by the static list).
    }
  }

  /** @type {Record<string, string[]>} */
  const directives = {
    'default-src': ["'self'"],
    // 'unsafe-inline': Next injects an inline bootstrap <script> and we ship an
    //   anti-flash theme <script> in app/layout.tsx (no nonce pipeline — a
    //   nonce would have to thread through the static <head> script and Next's
    //   own inline runtime, which Next does not expose a hook for).
    // 'unsafe-eval': required by the Mapbox GL worker and by `next dev`.
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://js.stripe.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://*.cloudfront.net',
      'https://*.mapbox.com',
      'https://*.tile.openstreetmap.org',
    ],
    'font-src': ["'self'", 'data:'],
    // Set-deduped: the derived origin may equal a static entry below.
    'connect-src': [
      ...new Set([
        "'self'",
        ...connectExtra,
        // Belt-and-suspenders: the live API origin even if the env var is unset
        // at header-build time on a misconfigured deploy.
        'https://api.ustowdispatch.cloud',
        'https://api.stripe.com',
        'https://api.mapbox.com',
        'https://*.mapbox.com',
        // Sentry ingest (non-tunneled fallback; tunnelRoute keeps the common
        // path same-origin via 'self').
        'https://*.ingest.sentry.io',
      ]),
    ],
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    // Mapbox GL spins up a worker from a blob: URL.
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([key, values]) => `${key} ${values.join(' ')}`);
  // Valueless directive: force http subresources to https in production.
  parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}
