import { apiServer } from '@/lib/api/client';
import { clearSessionCookies, readRefreshToken } from '@/lib/auth/cookies';
/**
 * BFF for logout. Forwards to the API with the refresh token from the cookie
 * so the API can revoke that specific session, then clears both cookies.
 */
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const refreshToken = await readRefreshToken();
  try {
    await apiServer('/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refreshToken } : {},
    });
  } catch {
    // logout is idempotent; cookies clear regardless.
  }
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
