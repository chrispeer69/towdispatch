/**
 * Server-side cookie helpers. Tokens NEVER touch localStorage; we put them in
 * httpOnly cookies set by the Next.js BFF routes. The refresh cookie is
 * SameSite=Strict to keep CSRF risk minimal — the access cookie is Lax so the
 * dashboard works behind a Stripe-style external redirect.
 */
import { cookies } from 'next/headers';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  MFA_CHALLENGE_COOKIE,
  MFA_CHALLENGE_TTL_SECONDS,
  MFA_SETUP_COOKIE,
  MFA_SETUP_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
} from './cookie-config';

// Re-export so existing call sites (server actions, route handlers) keep
// working unchanged. Edge middleware imports directly from cookie-config.
// Short-lived bridge cookies (tc_mfa_setup / tc_mfa_challenge) hold the JWT
// returned by /auth/login on the mfa_setup_required and mfa_required flows.
// The page-level MFA proxies read these and forward the value to the
// backend; the token itself is HttpOnly so it never reaches client JS.
export { ACCESS_COOKIE, REFRESH_COOKIE, MFA_SETUP_COOKIE, MFA_CHALLENGE_COOKIE };

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
