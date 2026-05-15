/**
 * Proactive access-token refresh at the edge.
 *
 * Why this exists: list pages on the authenticated shell (/customers,
 * /accounts, /jobs, /billing/invoices, /fleet/trucks, /fleet/drivers) were
 * rendering empty when users navigated via sidebar tabs after the 15-minute
 * `tc_at` access cookie expired. Server-component SSR calls
 * (apiServerSafe) cannot refresh tokens — Next.js forbids cookie writes
 * during a server-component render, so the existing refresh-on-401 logic
 * only fires in BFF route handlers (apiServerBff*). Without proactive
 * refresh, every SSR list-page fetch silently returned 401 after the
 * cookie aged out, and the 4xx-as-data behavior surfaced as an empty
 * table. The dashboard worked only because the cookie was fresh from login.
 *
 * What this does: for any authenticated shell route, decode `tc_at`'s exp
 * claim. If it's missing, malformed, or within 60s of expiry, swap the
 * refresh cookie for a fresh token pair via /auth/refresh and rewrite
 * the request cookies so the downstream server-component render sees the
 * new access token. Also rewrites the response cookies so the browser
 * holds the rotated pair on the way back.
 *
 * Runtime: Edge. Cannot import `next/headers` or any module that does;
 * cookie constants come from cookie-config.ts and the JWT exp read is
 * signature-less (signature verification happens at the API guard).
 */
import { type NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
} from './lib/auth/cookie-config';
import { readJwtExp } from './lib/auth/jwt-decode';

// Refresh this many seconds before the JWT actually expires, so an in-flight
// SSR fetch never races the clock and lands on the API with a just-dead token.
const EXP_SKEW_SECONDS = 60;

const resolveApiBase = (): string =>
  process.env.API_INTERNAL_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? null;

  if (!needsRefresh(access)) {
    return NextResponse.next();
  }

  // No refresh token means there's nothing to upgrade to. Send them to login
  // with a `next=` so post-auth they return to the same path.
  if (!refresh) {
    return redirectToLogin(req);
  }

  const refreshed = await callRefresh(refresh);
  if (!refreshed) {
    return redirectToLogin(req);
  }

  // Rewrite the REQUEST cookies so the downstream server-component render
  // sees the new access token via apiServerSafe's inline cookies() read.
  req.cookies.set(ACCESS_COOKIE, refreshed.accessToken);
  req.cookies.set(REFRESH_COOKIE, refreshed.refreshToken);
  const response = NextResponse.next({ request: req });

  // Rewrite the RESPONSE cookies so the browser holds the rotated pair on
  // the way back. Attributes mirror setSessionCookies in cookies.ts exactly.
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, refreshed.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
  response.cookies.set(REFRESH_COOKIE, refreshed.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  });
  return response;
}

function needsRefresh(access: string | null): boolean {
  if (!access) return true;
  const exp = readJwtExp(access);
  if (exp === null) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp - nowSec < EXP_SKEW_SECONDS;
}

async function callRefresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${resolveApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
      return null;
    }
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

function redirectToLogin(req: NextRequest): NextResponse {
  const next = req.nextUrl.pathname + req.nextUrl.search;
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(next)}`;
  const response = NextResponse.redirect(url);
  // Clear any stale auth cookies so the login page renders cleanly and the
  // user doesn't see a half-authenticated shell on the next attempt.
  response.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}

// Run on the authenticated app shell only. Exclude /login (no auth needed,
// would loop), /api/* (BFF routes own their refresh-on-401), /_next/* and
// static assets (no auth state needed, also a perf sink to refresh on every
// asset). The trailing `.*\\..*` excludes any path containing a dot — i.e.,
// every static asset under /public.
export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
