/**
 * BFF for /auth/mfa/challenge. Accepts a TOTP or recovery code from the
 * page, pairs it with the challengeToken from the bridge cookie, and on
 * success sets the session cookies.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { clearMfaCookies, readMfaChallengeCookie, setSessionCookies } from '@/lib/auth/cookies';
import type { AuthenticatedResponse } from '@towcommand/shared';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { code?: string } = {};
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  const challengeToken = await readMfaChallengeCookie();
  if (!challengeToken) {
    return NextResponse.json(
      { code: 'AUTH_REQUIRED', message: 'Your sign-in session expired. Sign in again.' },
      { status: 401 },
    );
  }
  try {
    const result = await apiServer<AuthenticatedResponse>('/auth/mfa/challenge', {
      method: 'POST',
      body: { challengeToken, code: body.code },
      authenticated: false,
    });
    await setSessionCookies({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    await clearMfaCookies();
    return NextResponse.json({
      status: 'authenticated',
      user: result.user,
      tenant: result.tenant,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
