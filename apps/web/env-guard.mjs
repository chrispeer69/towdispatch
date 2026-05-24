/**
 * Build-time guard for the browser-bound API base URL (R-14).
 *
 * The browser bundle reads NEXT_PUBLIC_API_URL (Socket.IO handshake, public
 * offer/track/pay pages). If it is missing, those code paths silently fall
 * back to http://localhost:3001 — which ships a production bundle that talks
 * to nothing. We refuse to build in that state.
 *
 * Pure function (takes an env bag, returns the resolved value or throws) so
 * it can be unit-tested without mutating process.env.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string} the resolved public API base
 */
export function assertPublicApiUrl(env) {
  const url = env.NEXT_PUBLIC_API_URL;
  const nodeEnv = env.NODE_ENV;
  if (url) return url;
  // Local dev is allowed to omit it — the dev fallback is localhost:3001.
  if (nodeEnv === 'development') return 'http://localhost:3001';
  throw new Error(
    'NEXT_PUBLIC_API_URL is required for non-development builds. ' +
      'Set it to the public API origin (e.g. https://api.towcommand.cloud) ' +
      'before running `next build`. Refusing to ship a bundle that falls ' +
      'back to http://localhost:3001.',
  );
}
