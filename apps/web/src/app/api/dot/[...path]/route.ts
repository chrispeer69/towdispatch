/**
 * BFF for /api/dot/* — proxies to the API's DOT compliance module.
 * Binary endpoint: GET audit-packet -> streams application/pdf.
 * Everything else is JSON. Mirrors /api/impound/[...path] shape.
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

  let body: unknown;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }

  // Stream the audit-packet PDF as binary.
  if (method === 'GET' && tail.startsWith('audit-packet')) {
    try {
      const res = await apiServerBffRaw(`/dot/${tail}${search}`, { method: 'GET' });
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/pdf',
          'content-disposition':
            res.headers.get('content-disposition') ?? 'attachment; filename="dot-audit-packet.pdf"',
        },
      });
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

  try {
    const data = await apiServerBff<unknown>(`/dot/${tail}${search}`, { method, body });
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
