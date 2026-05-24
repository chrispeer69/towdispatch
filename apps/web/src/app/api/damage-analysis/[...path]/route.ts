/**
 * BFF for /api/damage-analysis/* — proxies to the API's damage-analysis
 * module. JSON for the CRUD/compare endpoints; a binary passthrough for the
 * `report.pdf` endpoints (streamed via apiServerBffRaw, mirroring the
 * lien/billing PDF routes).
 */
import { ApiError, apiServerBff, apiServerBffRaw } from '@/lib/api/client';
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

  // Binary PDF passthrough (…/report.pdf). GET only.
  if (method === 'GET' && tail.endsWith('report.pdf')) {
    const upstream = await apiServerBffRaw(`/damage-analysis/${tail}${search}`, { method: 'GET' });
    if (!upstream.ok) {
      return NextResponse.json(
        { message: `Report unavailable (${upstream.status})` },
        { status: upstream.status },
      );
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      },
    });
  }

  let body: unknown;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }
  try {
    const data = await apiServerBff<unknown>(`/damage-analysis/${tail}${search}`, { method, body });
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
