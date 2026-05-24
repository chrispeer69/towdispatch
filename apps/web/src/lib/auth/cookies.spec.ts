import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-13. Exercises the session-cookie helpers' set/clear flags and the
 * header-parse path. next/headers is request-scoped at runtime; here we mock
 * it with a hoisted spy store. React's `cache` (used by getSessionToken) is
 * shimmed globally in vitest.setup.ts.
 */
const h = vi.hoisted(() => ({
  cookieHeader: '',
  setSpy: vi.fn<(name: string, value: string, opts?: Record<string, unknown>) => void>(),
  getSpy: vi.fn<(name: string) => { value: string } | undefined>(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: h.getSpy, set: h.setSpy })),
  headers: vi.fn(async () => ({
    get: (key: string) => (key === 'cookie' ? h.cookieHeader : null),
  })),
}));

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  getSessionToken,
  setSessionCookies,
} from './cookies';

beforeEach(() => {
  h.cookieHeader = '';
  h.setSpy.mockReset();
  h.getSpy.mockReset();
});

describe('setSessionCookies', () => {
  it('writes httpOnly access (lax, 15m) and refresh (strict, 30d) cookies', async () => {
    await setSessionCookies({ accessToken: 'access-tok', refreshToken: 'refresh-tok' });

    expect(h.setSpy).toHaveBeenCalledTimes(2);
    const [accessCall, refreshCall] = h.setSpy.mock.calls;

    expect(accessCall?.[0]).toBe(ACCESS_COOKIE);
    expect(accessCall?.[1]).toBe('access-tok');
    expect(accessCall?.[2]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    });

    expect(refreshCall?.[0]).toBe(REFRESH_COOKIE);
    expect(refreshCall?.[1]).toBe('refresh-tok');
    expect(refreshCall?.[2]).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it('does not set the Secure flag outside production (NODE_ENV=test)', async () => {
    await setSessionCookies({ accessToken: 'a', refreshToken: 'r' });
    expect(h.setSpy.mock.calls[0]?.[2]).toMatchObject({ secure: false });
  });
});

describe('clearSessionCookies', () => {
  it('expires both session cookies (maxAge 0)', async () => {
    await clearSessionCookies();
    expect(h.setSpy).toHaveBeenCalledTimes(2);
    expect(h.setSpy.mock.calls[0]).toEqual([
      ACCESS_COOKIE,
      '',
      { httpOnly: true, path: '/', maxAge: 0 },
    ]);
    expect(h.setSpy.mock.calls[1]).toEqual([
      REFRESH_COOKIE,
      '',
      { httpOnly: true, path: '/', maxAge: 0 },
    ]);
  });
});

describe('getSessionToken', () => {
  it('parses the access token from the request Cookie header', async () => {
    h.cookieHeader = `${ACCESS_COOKIE}=header-token; ${REFRESH_COOKIE}=rt`;
    await expect(getSessionToken()).resolves.toBe('header-token');
    // Header hit short-circuits before touching the cookie store.
    expect(h.getSpy).not.toHaveBeenCalled();
  });

  it('falls back to the cookie store when the header is absent', async () => {
    h.cookieHeader = '';
    h.getSpy.mockReturnValue({ value: 'store-token' });
    await expect(getSessionToken()).resolves.toBe('store-token');
    expect(h.getSpy).toHaveBeenCalledWith(ACCESS_COOKIE);
  });

  it('returns null when no token is anywhere', async () => {
    h.cookieHeader = '';
    h.getSpy.mockReturnValue(undefined);
    await expect(getSessionToken()).resolves.toBeNull();
  });
});
