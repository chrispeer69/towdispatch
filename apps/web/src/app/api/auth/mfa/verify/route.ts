/**
 * BFF for /auth/mfa/verify. The client submits a 6-digit TOTP code; we
 * pair it with the setupToken from the bridge cookie. On success the
 * backend returns a full authenticated response — we set the session
 * cookies, drop the bridge cookie, and respond with just the
 * user/tenant payload.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { clearMfaCookies, readMfaSetupCookie, setSessionCookies } from '@/lib/auth/cookies';
import type { AuthenticatedResponse } from '@towcommand/shared';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { totpCode?: string } = {};
  try {
    body = (await req.json()) as { totpCode?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  const setupToken = await readMfaSetupCookie();
  if (!setupToken) {
    return NextResponse.json(
      { code: 'AUTH_REQUIRED', message: 'Your enrollment session expired. Sign in again.' },
      { status: 401 },
    );
  }
  try {
    const result = await apiServer<AuthenticatedResponse>('/auth/mfa/verify', {
      method: 'POST',
      body: { setupToken, totpCode: body.totpCode },
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
