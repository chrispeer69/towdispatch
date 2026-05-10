/**
 * Returns the current access token for use as the Socket.IO connection auth.
 *
 * The web shell stores tokens in httpOnly cookies, but Socket.IO clients
 * need the token in the handshake auth payload. Rather than exposing tokens
 * to client JS at SSR time, the dispatch client fetches this BFF route on
 * mount; if the access cookie has expired the BFF refreshes it on the fly
 * (apiServerBff's standard 401-retry path) and returns the fresh one.
 *
 * The token is short-lived (15m) and bound to the same RLS context as the
 * dispatcher's HTTP requests, so reusing it for the socket adds no
 * additional risk surface.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { readAccessToken } from '@/lib/auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // Hit /auth/me to validate-or-refresh, then read the (possibly rotated)
  // access cookie back out and ship it to the caller. If the call fails the
  // session is gone — the page will reload and bounce to /login.
  try {
    await apiServerBff<unknown>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
  const accessToken = await readAccessToken();
  if (!accessToken) {
    return NextResponse.json({ message: 'No session' }, { status: 401 });
  }
  return NextResponse.json({
    accessToken,
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  });
}
