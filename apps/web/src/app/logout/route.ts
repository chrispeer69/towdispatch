import { ApiError, apiServer } from '@/lib/api/client';
import { clearSessionCookies, readRefreshToken } from '@/lib/auth/cookies';
/**
 * GET /logout: a simple bookmarkable URL that clears the session and bounces
 * the visitor home. POSTs from forms route through /api/auth/logout instead.
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  const refreshToken = await readRefreshToken();
  try {
    await apiServer('/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refreshToken } : {},
    });
  } catch (err) {
    // Idempotent — log and proceed.
    if (!(err instanceof ApiError)) {
      // eslint-disable-next-line no-console
      console.warn('logout: forwarding to API failed', err);
    }
  }
  await clearSessionCookies();
  return NextResponse.redirect(
    new URL('/', process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  );
}
