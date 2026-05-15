/**
 * Read the `exp` (expiry) claim from a JWT without verifying the signature.
 *
 * Used by middleware to decide whether to proactively call /auth/refresh
 * before the API rejects the token. The signature IS verified later, at the
 * API JWT guard — middleware only needs the timestamp, and signature checks
 * are infeasible in the Edge runtime (no access to the secret).
 *
 * Returns the exp claim in epoch seconds, or null when the token is missing,
 * malformed, or has no exp.
 */
export function readJwtExp(token: string): number | null {
  const parts = token.split('.');
  const b64url = parts[1];
  if (parts.length !== 3 || !b64url) return null;
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
