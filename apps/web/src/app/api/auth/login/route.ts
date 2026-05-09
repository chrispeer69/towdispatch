import { ApiError, apiServer } from '@/lib/api/client';
import { setSessionCookies } from '@/lib/auth/cookies';
import type { LoginResponse } from '@towcommand/shared';
/**
 * BFF for /auth/login. The API may return one of three shapes:
 *   - authenticated: tokens + user/tenant (set cookies, strip tokens)
 *   - needs_tenant_selection: forward as-is so client can render a tenant picker
 *   - mfa_required: forward mfaToken so client can prompt for TOTP
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
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { code: err.code, message: err.message, errors: err.details },
        {
          status: err.status,
        },
      );
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
