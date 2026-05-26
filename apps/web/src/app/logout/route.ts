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
  // Read the host header (or x-forwarded-host from Railway's proxy) instead of 
  // nextUrl.origin, which can be the internal docker IP (e.g. 0.0.0.0:8080).
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const protocol = req.headers.get('x-forwarded-proto') || 'https';
  
  // For local development, it will stay http://localhost:3000
  const finalProtocol = host.includes('localhost') ? 'http' : protocol;
  
  const target = `${finalProtocol}://${host}/login`;
  return NextResponse.redirect(target);
}
