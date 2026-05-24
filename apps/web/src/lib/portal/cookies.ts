/**
 * Customer-portal session cookie (Session 32). Deliberately a DIFFERENT
 * cookie name from the staff session (tc_at) so the two realms never collide
 * on a shared host. httpOnly; never touches localStorage. The portal token is
 * stateless (no refresh rotation in v1 — see SESSION_32_DECISIONS.md), so a
 * single access cookie with the backend TTL is all we store.
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

export const PORTAL_COOKIE = 'tc_portal_at';

// Matches the backend JWT_PORTAL_TTL default (24h).
const PORTAL_TTL_SECONDS = 24 * 60 * 60;

export const readPortalToken = cache(async (): Promise<string | null> => {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const fromHeader =
    cookieHeader
      .split(/;\s*/)
      .find((c) => c.startsWith(`${PORTAL_COOKIE}=`))
      ?.slice(PORTAL_COOKIE.length + 1) ?? null;
  if (fromHeader) return fromHeader;
  return (await cookies()).get(PORTAL_COOKIE)?.value ?? null;
});

export async function setPortalCookie(
  token: string,
  maxAgeSeconds = PORTAL_TTL_SECONDS,
): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function clearPortalCookie(): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
