import type { MeResponse } from '@towcommand/shared';
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
    const h = await headers();
    const path = h.get('x-current-path') ?? '/dashboard';
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return me;
}
