/**
 * BFF for /api/driver-briefings/* — proxies admin authoring + the
 * training completion log to the API. Driver-side endpoints
 * (active / needs-acknowledgment / acknowledge) ride driver JWTs and
 * are reached directly from the driver app at the API origin, so they
 * deliberately don't route through this BFF.
 *
 * Mirrors the dynamic-pricing BFF pattern.
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
    const upstream = await apiServerBff<unknown, unknown>(`/driver-briefings/${tail}${search}`, {
      method,
      body: body as never,
    });
    return NextResponse.json(upstream as object);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    throw err;
  }
}

export const GET = (req: NextRequest, ctx: Ctx) => proxy(req, ctx, 'GET');
export const POST = (req: NextRequest, ctx: Ctx) => proxy(req, ctx, 'POST');
export const PATCH = (req: NextRequest, ctx: Ctx) => proxy(req, ctx, 'PATCH');
export const DELETE = (req: NextRequest, ctx: Ctx) => proxy(req, ctx, 'DELETE');
