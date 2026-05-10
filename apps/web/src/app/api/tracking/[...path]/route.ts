/**
 * Tracking BFF proxy. Same shape as the dispatch proxy — auth-required calls
 * fronted with refresh-on-401. Used by the dispatch-board TrackingBadge UI
 * and the reporting dashboard.
 *
 * The PUBLIC tracking surface (no auth) goes directly to the API at
 * /public/track/* and does NOT route through this proxy.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

async function forward(
  req: NextRequest,
  path: string[],
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const upstream = `/tracking/${path.join('/')}`;
  let body: unknown;
  if (method !== 'GET') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }
  try {
    const data = await apiServerBff<unknown>(upstream, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    return NextResponse.json(data ?? null, { status: 200 });
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  return forward(req, path, 'GET');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  return forward(req, path, 'POST');
}
