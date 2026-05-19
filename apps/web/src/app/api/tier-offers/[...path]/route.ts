/**
 * BFF for /api/tier-offers/* — proxies to the API's tier-offers module.
 * Mirrors /api/dynamic-pricing/[...path] shape. CSV downloads under
 * /:id/reconciliation.csv pass straight through binary.
 */
import { ApiError, apiServerBff, apiServerBffRaw } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

function expectsBinary(tail: string): boolean {
  return tail.endsWith('/reconciliation.csv');
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
  const binary = expectsBinary(tail);
  try {
    if (binary) {
      const upstream = await apiServerBffRaw(`/tier-offers/${tail}${search}`, {
        method: 'GET',
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const headers = new Headers();
      const ct = upstream.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      const cd = upstream.headers.get('content-disposition');
      if (cd) headers.set('content-disposition', cd);
      return new NextResponse(buf, { status: upstream.status, headers });
    }
    const data = await apiServerBff<unknown>(`/tier-offers/${tail}${search}`, {
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
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'PUT');
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'DELETE');
}
