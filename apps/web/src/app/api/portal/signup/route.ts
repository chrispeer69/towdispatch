/**
 * BFF: portal signup (Session 32). Always resolves to { ok: true } from the
 * API (email-gated, no account enumeration); we just pass it through.
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import type { PortalGenericOk, PortalSignupPayload } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: PortalSignupPayload;
  try {
    body = (await req.json()) as PortalSignupPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await portalApi<PortalGenericOk, PortalSignupPayload>('/portal/signup', {
      method: 'POST',
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof PortalApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
