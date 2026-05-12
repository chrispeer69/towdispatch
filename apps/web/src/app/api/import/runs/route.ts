/**
 * BFF for /import/runs.
 *
 * GET — proxies list of recent runs.
 * POST — forwards a raw application/zip body up to 2 GiB to the backend.
 * The browser → BFF → API path is intentionally pass-through so we don't
 * have to materialize the entire ZIP in Next's process heap.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

const apiBase = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/import/runs', { method: 'GET' });
    return NextResponse.json(data);
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  // We deliberately bypass apiServerBff for the upload because that helper
  // serialises the body as JSON. The backend wants raw bytes.
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('tc_at')?.value ?? null;
  if (!accessToken) return NextResponse.json({ message: 'unauthenticated' }, { status: 401 });

  const body = await req.arrayBuffer();
  const upstream = await fetch(`${apiBase()}/import/runs${search}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/zip',
    },
    body,
    // duplex required for large bodies in Next 15 / undici
    // @ts-expect-error duplex is valid at runtime
    duplex: 'half',
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

function handle(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { code: err.code, message: err.message, errors: err.details },
      { status: err.status },
    );
  }
  return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
}
