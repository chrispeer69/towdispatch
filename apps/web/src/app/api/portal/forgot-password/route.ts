/**
 * BFF: portal forgot-password (Session 32). Always { ok: true } (no leak).
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import type { PortalForgotPasswordPayload, PortalGenericOk } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: PortalForgotPasswordPayload;
  try {
    body = (await req.json()) as PortalForgotPasswordPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await portalApi<PortalGenericOk, PortalForgotPasswordPayload>(
      '/portal/forgot-password',
      { method: 'POST', body },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof PortalApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
