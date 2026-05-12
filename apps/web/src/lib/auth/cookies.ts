/**
 * Server-side cookie helpers. Tokens NEVER touch localStorage; we put them in
 * httpOnly cookies set by the Next.js BFF routes. The refresh cookie is
 * SameSite=Strict to keep CSRF risk minimal — the access cookie is Lax so the
 * dashboard works behind a Stripe-style external redirect.
 */
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'tc_at';
export const REFRESH_COOKIE = 'tc_rt';
// Short-lived bridge cookies that hold the JWT returned by /auth/login when
// the response is mfa_setup_required or mfa_required. The page-level MFA
// proxies read these and forward the value to the backend. The token itself
// is HttpOnly so it never reaches client JS — only the proxies see it.
export const MFA_SETUP_COOKIE = 'tc_mfa_setup';
export const MFA_CHALLENGE_COOKIE = 'tc_mfa_challenge';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
// Match the backend JWT TTLs so an expired cookie always means the token is
// also dead. /auth/mfa/setup is signed for 15m, /auth/mfa/challenge for 5m.
const MFA_SETUP_TTL_SECONDS = 15 * 60;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

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

export async function setMfaSetupCookie(token: string): Promise<void> {
  const store = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  store.set(MFA_SETUP_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: MFA_SETUP_TTL_SECONDS,
  });
}

export async function setMfaChallengeCookie(token: string): Promise<void> {
  const store = await cookies();
  const isProd = process.env.NODE_ENV === 'production';
  store.set(MFA_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: MFA_CHALLENGE_TTL_SECONDS,
  });
}

export async function readMfaSetupCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(MFA_SETUP_COOKIE)?.value ?? null;
}

export async function readMfaChallengeCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(MFA_CHALLENGE_COOKIE)?.value ?? null;
}

export async function clearMfaCookies(): Promise<void> {
  const store = await cookies();
  store.set(MFA_SETUP_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  store.set(MFA_CHALLENGE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
