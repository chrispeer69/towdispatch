import { ApiError, apiServer } from '@/lib/api/client';
import { setSessionCookies } from '@/lib/auth/cookies';
import type { AuthenticatedResponse } from '@towcommand/shared';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const result = await apiServer<AuthenticatedResponse>('/auth/mfa/login', {
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
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
