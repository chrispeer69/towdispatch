/**
 * BFF: portal reset-password (Session 32). Consumes the reset token + sets a
 * new password. Token-based, so no host resolution is required.
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import type { PortalGenericOk, PortalResetPasswordPayload } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: PortalResetPasswordPayload;
  try {
    body = (await req.json()) as PortalResetPasswordPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await portalApi<PortalGenericOk, PortalResetPasswordPayload>(
      '/portal/reset-password',
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
