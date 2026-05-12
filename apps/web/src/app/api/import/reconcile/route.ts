/**
 * BFF for /import/reconcile — pass-through binary upload.
 */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

const apiBase = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('tc_at')?.value ?? null;
  if (!accessToken) return NextResponse.json({ message: 'unauthenticated' }, { status: 401 });

  const body = await req.arrayBuffer();
  const upstream = await fetch(`${apiBase()}/import/reconcile${search}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/zip',
    },
    body,
    // @ts-expect-error duplex is valid at runtime
    duplex: 'half',
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
