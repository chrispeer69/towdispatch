import { ApiError, apiServer } from '@/lib/api/client';
import {
  clearMfaCookies,
  setMfaChallengeCookie,
  setMfaSetupCookie,
  setSessionCookies,
} from '@/lib/auth/cookies';
import type { LoginResponse } from '@towdispatch/shared';
/**
 * BFF for /auth/login. Three branches:
 *   - authenticated:        set session cookies, strip tokens
 *   - needs_tenant_selection: pass through so the form can render the picker
 *   - mfa_required:         store the challengeToken in an httpOnly cookie
 *                           so the browser never sees it; respond with just
 *                           status so the form can redirect to /auth/mfa/challenge
 *   - mfa_setup_required:   same idea, but for the enrollment flow
 */
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    // A fresh login invalidates any stale MFA bridge cookies (the user might
    // be coming back from a half-finished enrollment with a different email).
    await clearMfaCookies();

    const result = await apiServer<LoginResponse>('/auth/login', {
      method: 'POST',
      body,
      authenticated: false,
    });
    if (result.status === 'authenticated') {
      await setSessionCookies({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return NextResponse.json({
        status: 'authenticated',
        user: result.user,
        tenant: result.tenant,
      });
    }
    if (result.status === 'mfa_required') {
      await setMfaChallengeCookie(result.challengeToken);
      return NextResponse.json({ status: 'mfa_required' });
    }
    if (result.status === 'mfa_setup_required') {
      await setMfaSetupCookie(result.setupToken);
      return NextResponse.json({ status: 'mfa_setup_required', role: result.role });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { code: err.code, message: err.message, errors: err.details },
        { status: err.status },
      );
    }
    // Non-ApiError exceptions used to surface as the opaque
    // "Unexpected error" message, which made diagnosing login
    // failures impossible (was it a network blip to the API, a
    // cookies() write failure, a malformed response, …?). Log the
    // full error to the server console + bubble the constructor name
    // and message back to the client so the failure mode is at least
    // visible in the toast. Password never reaches this catch — the
    // body was already serialized into the apiServer call above.
    // eslint-disable-next-line no-console
    console.error('[auth/login] non-ApiError exception', {
      tag: 'auth/login:non-api-error',
      errorName: err instanceof Error ? err.constructor.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const message =
      err instanceof Error
        ? `Login failed: ${err.constructor.name}${err.message ? ` — ${err.message}` : ''}`
        : 'Login failed: unknown error';
    return NextResponse.json({ code: 'login_failed', message }, { status: 500 });
  }
}
