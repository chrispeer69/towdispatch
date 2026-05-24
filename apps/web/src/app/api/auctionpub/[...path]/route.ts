/**
 * Public auction BFF — forwards the bidder marketplace + bidder-auth calls
 * to the API. Unlike the operator BFFs this does NOT attach staff session
 * cookies; the bidder JWT (when present) rides in the incoming
 * Authorization header, which is forwarded verbatim. Same-origin from the
 * browser's perspective, so no CORS. Only `marketplace/*` and
 * `bidder-auth/*` tails are allowed.
 */
import { type NextRequest, NextResponse } from 'next/server';

const apiBase = (): string =>
  process.env.API_INTERNAL_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

const ALLOWED_PREFIXES = ['marketplace', 'bidder-auth'];

async function proxy(req: NextRequest, ctx: Ctx, method: 'GET' | 'POST'): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (path.length === 0 || !ALLOWED_PREFIXES.includes(path[0] ?? '')) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const tail = path.join('/');
  const search = req.nextUrl.search;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;

  let body: string | undefined;
  if (method === 'POST') {
    body = await req.text();
  }

  const res = await fetch(`${apiBase()}/${tail}${search}`, {
    method,
    headers,
    cache: 'no-store',
    ...(body !== undefined ? { body } : {}),
  });

  const text = await res.text();
  if (!text) return new NextResponse(null, { status: res.status });
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'GET');
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx, 'POST');
}
