/**
 * BFF: portal logout (Session 32). Clears the portal cookie. The portal token
 * is stateless (no server-side session row to revoke in v1).
 */
import { clearPortalCookie } from '@/lib/portal/cookies';
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  await clearPortalCookie();
  return NextResponse.json({ ok: true });
}
