/**
 * Browser-visible API base URL (R-14).
 *
 * Client components ('use client') and the public offer/track/pay pages bundle
 * this value into the browser. NEXT_PUBLIC_API_URL is replaced at build time by
 * Next. Production builds are guaranteed to have it (the build-time guard in
 * env-guard.mjs refuses to build otherwise), so the localhost fallback here is
 * dev-only and the production path never silently points at localhost.
 *
 * Server-side fetches use the richer resolver in lib/api/client.ts
 * (API_INTERNAL_URL → API_PUBLIC_URL → NEXT_PUBLIC_API_URL). This helper is for
 * browser-bound code only.
 */
export function publicApiBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url) return url;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3001';
  // Defense in depth — the build-time guard should have already failed.
  throw new Error('NEXT_PUBLIC_API_URL is not configured for this production build.');
}
