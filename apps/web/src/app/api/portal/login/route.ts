/**
 * BFF: portal login (Session 32). Forwards to the API with the resolved
 * X-Portal-Host, and on success stows the stateless portal token in an
 * httpOnly cookie. Never returns the token to client JS.
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import { setPortalCookie } from '@/lib/portal/cookies';
import type { PortalAuthResponse, PortalLoginPayload } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: PortalLoginPayload;
  try {
    body = (await req.json()) as PortalLoginPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await portalApi<PortalAuthResponse, PortalLoginPayload>('/portal/login', {
      method: 'POST',
      body,
    });
    await setPortalCookie(data.accessToken, data.expiresIn);
    return NextResponse.json({ user: data.user });
  } catch (err) {
    if (err instanceof PortalApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
