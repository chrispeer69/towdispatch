import { ApiError, apiServer } from '@/lib/api/client';
import { clearSessionCookies, readRefreshToken } from '@/lib/auth/cookies';
/**
 * GET /logout: a simple bookmarkable URL that clears the session and bounces
 * the visitor home. POSTs from forms route through /api/auth/logout instead.
 *
 * Idempotent: must always clear cookies and return a 302, even if the API
 * forward or cookie reader throws — otherwise a transient API hiccup leaves
 * the user logged-in-looking but with no working session.
 */
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const refreshToken = await readRefreshToken().catch(() => null);
    try {
      await apiServer('/auth/logout', {
        method: 'POST',
        body: refreshToken ? { refreshToken } : {},
      });
    } catch (err) {
      // Idempotent — log non-ApiError and proceed; ApiError just means the
      // API responded with a non-2xx, which is fine for logout.
      if (!(err instanceof ApiError)) {
        // eslint-disable-next-line no-console
        console.warn('logout: forwarding to API failed', err);
      }
    }
  } finally {
    await clearSessionCookies().catch(() => undefined);
  }
  // Redirect to the current host's "/" so the user lands on whatever origin
  // they came from (avoids the previous fallback to localhost:3000, which
  // broke in any deployment serving the web app on a different port — e.g.
  // CI runs on 3600).
  const target = new URL('/login', req.nextUrl.origin).toString();
  return NextResponse.redirect(target);
}
