/**
 * BFF for /api/capacity/* — proxies to the API's CADS module
 * (/capacity/*). Mirrors the shape of /api/dynamic-pricing/[...path]:
 * refresh-on-401 via apiServerBff, ApiError passthrough, 204 for empty
 * bodies (override clear, partner delete).
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

async function proxy(
  req: NextRequest,
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const tail = path.join('/');
  const search = req.nextUrl.search;
  let body: unknown;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }
  try {
    const data = await apiServerBff<unknown>(`/capacity/${tail}${search}`, {
      method,
      body,
    });
    if (data === undefined || data === null) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(data);
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

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'GET');
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'POST');
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'PATCH');
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'DELETE');
}
