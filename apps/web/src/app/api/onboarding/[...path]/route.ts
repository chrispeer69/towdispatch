/**
 * Catch-all BFF for /api/onboarding/* (authenticated wizard endpoints:
 * progress, steps/*, skip, complete). Proxies through to the API with the
 * refresh-on-401 retry, mirroring apps/web/src/app/api/fleet/[...path]/route.ts.
 *
 * /api/onboarding/start has its own handler (it must set session cookies and
 * runs unauthenticated); Next.js routes the static `start` segment ahead of
 * this catch-all. See SESSION_25_DECISIONS.md for why the onboarding BFF lives
 * outside the literal signup/ scope.
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
    const data = await apiServerBff<unknown>(`/onboarding/${tail}${search}`, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    return NextResponse.json(data, { status: 200 });
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
