/**
 * BFF: portal verify-email (Session 32). Consumes the email-verification
 * token. Token-based, so no host resolution is required.
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import type { PortalGenericOk, PortalVerifyEmailPayload } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: PortalVerifyEmailPayload;
  try {
    body = (await req.json()) as PortalVerifyEmailPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await portalApi<PortalGenericOk, PortalVerifyEmailPayload>(
      '/portal/verify-email',
      {
        method: 'POST',
        body,
      },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof PortalApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
