import type { MeResponse } from '@ustowdispatch/shared';
import { headers } from 'next/headers';
/**
 * Server-side session loaders.
 *
 *   getOptionalUser() — returns null if there's no valid session. Used by
 *   the verify-email-pending page (where we still want to show the user's
 *   email) and by any conditional UI in the unauthenticated shell.
 *
 *   requireUser() — server-side guard for the authenticated shell. Throws
 *   the special `redirect()` error if there's no valid session, sending the
 *   visitor to /login?next=<currentPath>.
 *
 * Both call apiServer (read-only) — they never write cookies. Next.js 15
 * forbids cookies().set() during a server-component render, so refreshing
 * inline here would crash. If the access token is expired the API answers
 * 401, we treat that as unauthenticated, and requireUser() bounces to /login.
 * The login page (and the BFF route handlers under /api/*) handle issuing a
 * fresh token pair.
 *
 * IMPORTANT — what counts as "the session is dead":
 * Only a 401/403 from `/auth/me` means the user themselves is unauthenticated
 * and must be redirected to /login. A 401 from a per-feature endpoint (e.g.
 * /accounting/status because finance scope is missing, or /payments/connect
 * because Stripe is not yet linked) is NOT a session-expiry signal — those are
 * authorization decisions made per-resource on a perfectly valid session, and
 * redirecting on them would log the user out for clicking a feature they don't
 * have access to. Page-level fetches must catch those 4xx responses (via the
 * apiServerSafe variant or tryFetch helper in lib/api/client.ts) and degrade
 * gracefully. The `/auth/me` redirect below is the single chokepoint that
 * decides "you need a new session" — do not replicate this redirect logic in
 * feature pages.
 */
import { redirect } from 'next/navigation';
import { ApiError, apiServer } from '../api/client';

export async function getOptionalUser(): Promise<MeResponse | null> {
  try {
    return await apiServer<MeResponse>('/auth/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export async function requireUser(): Promise<MeResponse> {
  const me = await getOptionalUser();
  if (!me) {
    // Redirect ONLY fires here, where /auth/me itself said "not logged in".
    // Per-feature 401s never reach this code — they live in the feature
    // pages and are surfaced as data, not as a session-expiry signal.
    const h = await headers();
    const path = h.get('x-current-path') ?? '/dashboard';
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return me;
}
