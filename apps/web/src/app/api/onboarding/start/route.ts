import { ApiError, apiServer } from '@/lib/api/client';
import { setSessionCookies } from '@/lib/auth/cookies';
import type { OnboardingStartResponse } from '@ustowdispatch/shared';
/**
 * BFF for /onboarding/start (public). Forwards the signup + captcha payload to
 * the API and, on success, sets the httpOnly access + refresh cookies so the
 * rest of the wizard can call the tenant-scoped onboarding endpoints. Tokens
 * are stripped from the JSON the browser sees; the onboarding progress is
 * returned so the wizard can render its initial state.
 *
 * Mirrors apps/web/src/app/api/auth/signup/route.ts. Lives here (not in the
 * literal signup/ dir) because the web BFF layer is the only way the wizard
 * can reach the onboarding API without exposing the access token — see
 * SESSION_25_DECISIONS.md.
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
    const result = await apiServer<OnboardingStartResponse>('/onboarding/start', {
      method: 'POST',
      body,
      authenticated: false,
    });
    await setSessionCookies({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return NextResponse.json({
      status: result.status,
      user: result.user,
      tenant: result.tenant,
      onboarding: result.onboarding,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { code: err.code, message: err.message, errors: err.details },
        { status: err.status },
      );
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
