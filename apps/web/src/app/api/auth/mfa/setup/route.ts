/**
 * BFF for /auth/mfa/setup. Reads the setupToken from the httpOnly
 * tc_mfa_setup cookie (placed there by /api/auth/login on
 * mfa_setup_required) and forwards it to the backend. Returns the QR
 * code + recovery codes to the client — both are needed for the user
 * to enroll, so they DO reach the browser. The setupToken itself stays
 * server-side.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { readMfaSetupCookie } from '@/lib/auth/cookies';
import type { MfaSetupResponse } from '@towcommand/shared';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const setupToken = await readMfaSetupCookie();
  if (!setupToken) {
    return NextResponse.json(
      { code: 'AUTH_REQUIRED', message: 'No active enrollment. Sign in to start MFA setup.' },
      { status: 401 },
    );
  }
  try {
    const result = await apiServer<MfaSetupResponse>('/auth/mfa/setup', {
      method: 'POST',
      body: { setupToken },
      authenticated: false,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
