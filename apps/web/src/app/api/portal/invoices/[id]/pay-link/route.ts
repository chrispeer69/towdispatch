/**
 * BFF: portal invoice pay-link (Session 32). Asks the API for the public
 * pay-page URL for an invoice the caller owns, then the client redirects the
 * browser there (the existing /pay/[token] page handles Stripe + the
 * PAYMENTS_PROVIDER flag).
 */
import { PortalApiError, portalApi } from '@/lib/portal/client';
import { readPortalToken } from '@/lib/portal/cookies';
import type { PortalPayLinkResponse } from '@ustowdispatch/shared';
import { NextResponse } from 'next/server';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await readPortalToken();
  if (!token) {
    return NextResponse.json({ code: 'unauthorized', message: 'Not signed in' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const data = await portalApi<PortalPayLinkResponse>(`/portal/invoices/${id}/pay-link`, {
      method: 'POST',
      token,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof PortalApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
