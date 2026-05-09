/**
 * Server-side cookie helpers. Tokens NEVER touch localStorage; we put them in
 * httpOnly cookies set by the Next.js BFF routes. The refresh cookie is
 * SameSite=Strict to keep CSRF risk minimal — the access cookie is Lax so the
 * dashboard works behind a Stripe-style external redirect.
 */
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'tc_at';
export const REFRESH_COOKIE = 'tc_rt';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SetSessionCookiesOpts {
  accessToken: string;
  refreshToken: string;
}

export async function setSessionCookies(opts: SetSessionCookiesOpts): Promise<void> {
  const store = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  store.set(ACCESS_COOKIE, opts.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
  store.set(REFRESH_COOKIE, opts.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  store.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function readAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function readRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}
