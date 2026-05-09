import { tryRefresh } from '@/lib/api/client';
import { readAccessToken, readRefreshToken } from '@/lib/auth/cookies';
/**
 * Client-callable refresh endpoint. Returns 200 if a fresh access cookie was
 * minted (or one was already present), 401 if there is no valid refresh
 * token to use.
 *
 * Designed to be invoked from the browser (e.g. before navigating to a
 * protected SSR page) so cookie writes happen inside a Route Handler context
 * — the only place Next.js 15 allows cookies().set().
 */
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const refresh = await readRefreshToken();
  if (!refresh) {
    return NextResponse.json({ refreshed: false }, { status: 401 });
  }
  const result = await tryRefresh();
  if (!result) {
    return NextResponse.json({ refreshed: false }, { status: 401 });
  }
  return NextResponse.json({ refreshed: true });
}

export async function GET(): Promise<NextResponse> {
  // Convenience for clients that prefer GET — same semantics as POST.
  const access = await readAccessToken();
  if (access) return NextResponse.json({ refreshed: false, currentlyValid: true });
  return POST();
}
