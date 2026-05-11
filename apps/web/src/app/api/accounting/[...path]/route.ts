/**
 * Catch-all BFF for /api/accounting/* — proxies to the API with refresh-on-401.
 * Mirrors the Session 10 billing + Session 11 payments BFFs.
 *
 * QBO webhook ingest (POST /webhooks/quickbooks) is NOT routed through this
 * BFF — Intuit posts directly to the API origin so the signed payload bytes
 * survive intact.
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
    const data = await apiServerBff<unknown>(`/accounting/${tail}${search}`, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    if (method === 'DELETE') return NextResponse.json(data ?? {}, { status: 200 });
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
export async function PUT(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'PUT');
}
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy(req, ctx, 'DELETE');
}
