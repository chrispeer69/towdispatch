/**
 * BFF for /api/ar/* — proxies to the Build 5 AR module on the API.
 *
 * Endpoints whose response is a binary file (xlsx report exports + PDF
 * statement renders) stream the body straight through; everything else
 * is JSON. We detect binary endpoints by tail-path inspection rather
 * than by response Content-Type since the latter is only available
 * after the fetch has resolved.
 *
 * Mirrors the /api/billing/[...path] proxy in shape so the refresh-on-
 * 401 behavior is consistent.
 */
import { ApiError, apiServerBff, apiServerBffRaw } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

function expectsBinary(tail: string, method: string, search: string): boolean {
  if (tail.startsWith('reports/') && search.includes('format=xlsx')) return true;
  if (tail.startsWith('reports/') && search.includes('format=pdf')) return true;
  if (tail === 'statements/pdf' && method === 'POST') return true;
  return false;
}

async function proxy(
  req: NextRequest,
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const tail = path.join('/');
  const search = req.nextUrl.search;

  // Read body once if relevant.
  let body: unknown;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }

  const binary = expectsBinary(tail, method, search);

  try {
    if (binary) {
      // apiServerBffRaw doesn't accept a body. For statements/pdf we
      // POST, so we build a custom raw call here using the same
      // refresh-on-401 dance but with a JSON body.
      if (method === 'POST') {
        const res = await rawPostWithBody(`/ar/${tail}${search}`, body ?? {});
        return new NextResponse(res.body, {
          status: res.status,
          headers: {
            'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
            'content-disposition':
              res.headers.get('content-disposition') ?? 'attachment; filename="download"',
          },
        });
      }
      const res = await apiServerBffRaw(`/ar/${tail}${search}`, { method: 'GET' });
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
          'content-disposition':
            res.headers.get('content-disposition') ?? 'attachment; filename="download"',
        },
      });
    }
    const data = await apiServerBff<unknown>(`/ar/${tail}${search}`, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    if (method === 'DELETE') return NextResponse.json(data ?? {}, { status: 200 });
    return NextResponse.json(data, { status: method === 'POST' ? 200 : 200 });
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

/**
 * Tiny POST-with-body helper that returns the raw Response for
 * binary streaming. Re-uses apiServerBffRaw's refresh-on-401 by going
 * through the client's tryRefresh-aware path via apiServerBff's
 * JSON branch is wrong (it parses); instead we call the API ourselves
 * with the resolved token. Keep this co-located to avoid widening the
 * public client API surface.
 */
async function rawPostWithBody(path: string, body: unknown): Promise<Response> {
  const { readAccessToken } = await import('@/lib/auth/cookies');
  const accessToken = await readAccessToken();
  const apiBase =
    process.env.API_INTERNAL_URL ??
    process.env.API_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001';
  const url = `${apiBase}${path}`;
  const buildInit = (token: string | null): RequestInit => ({
    method: 'POST',
    headers: {
      Accept: 'application/pdf',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let res = await fetch(url, buildInit(accessToken));
  if (res.status === 401) {
    const { tryRefresh } = await import('@/lib/api/client');
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetch(url, buildInit(refreshed.accessToken));
    }
  }
  return res;
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
