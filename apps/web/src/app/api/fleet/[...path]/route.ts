/**
 * Catch-all BFF for /api/fleet/* — proxies the path through to the API
 * with refresh-on-401 retry. Mirrors the dispatch BFF wired in Session 5.
 *
 * Used by the client-side fleet pages to call into the NestJS controllers
 * without exposing the access token to the browser.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

async function proxy(
  req: NextRequest,
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const tail = path.join('/');
  const search = req.nextUrl.search;
  let body: unknown;
  if (method === 'POST' || method === 'PATCH') {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
    }
  }
  try {
    const data = await apiServerBff<unknown>(`/fleet/${tail}${search}`, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    if (method === 'DELETE') return new NextResponse(null, { status: 204 });
    return NextResponse.json(data, { status: method === 'POST' ? 201 : 200 });
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

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'GET');
}
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'POST');
}
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'DELETE');
}
