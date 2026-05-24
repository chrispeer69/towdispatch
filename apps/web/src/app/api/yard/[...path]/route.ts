/**
 * BFF for /api/yard/* — proxies JSON to the API's Yard Management module
 * (facilities, stalls, rate-cards, billing, release, gate-search). Mirrors
 * the lien-cases proxy.
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
    const data = await apiServerBff<unknown>(`/yard/${tail}${search}`, { method, body });
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
