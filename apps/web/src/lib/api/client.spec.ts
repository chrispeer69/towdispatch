import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-13. Covers the server fetch wrapper's request building and the BFF
 * refresh-on-401 retry. next/headers and global fetch are mocked; React's
 * `cache` (pulled in via lib/auth/cookies) is shimmed in vitest.setup.ts.
 */
const h = vi.hoisted(() => ({
  cookieHeader: '',
  setSpy: vi.fn(),
  getSpy: vi.fn<(name: string) => { value: string } | undefined>(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: h.getSpy, set: h.setSpy })),
  headers: vi.fn(async () => ({
    get: (key: string) => (key === 'cookie' ? h.cookieHeader : null),
  })),
}));

import { apiServer, apiServerBffSafe } from './client';

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  clone: () => FakeResponse;
}

function fakeResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => fakeResponse(status, body),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  h.cookieHeader = '';
  h.setSpy.mockReset();
  h.getSpy.mockReset();
  h.getSpy.mockReturnValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiServer request building', () => {
  it('builds an authenticated JSON POST to the resolved base', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { ok: true }));

    const result = await apiServer<{ ok: boolean }>('/reports', {
      method: 'POST',
      body: { name: 'q1' },
      accessToken: 'access-tok',
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/reports$/);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe(JSON.stringify({ name: 'q1' }));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-tok');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
  });

  it('omits Authorization when authenticated:false', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, {}));
    await apiServer('/public', { authenticated: false });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('apiServerBffSafe refresh-on-401', () => {
  it('refreshes the token and retries once, then succeeds', async () => {
    // resolveRefreshToken reads the refresh cookie from the request header.
    h.cookieHeader = 'tc_rt=refresh-tok';
    fetchMock
      .mockResolvedValueOnce(fakeResponse(401, { code: 'unauthorized' })) // initial
      .mockResolvedValueOnce(fakeResponse(200, { accessToken: 'new-tok', refreshToken: 'new-rt' })) // /auth/refresh
      .mockResolvedValueOnce(fakeResponse(200, { value: 42 })); // retry

    const result = await apiServerBffSafe<{ value: number }>('/things', {
      accessToken: 'stale-tok',
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The refresh hop hit /auth/refresh.
    const refreshUrl = (fetchMock.mock.calls[1] as [string, RequestInit])[0];
    expect(refreshUrl).toMatch(/\/auth\/refresh$/);

    // The retry carried the rotated bearer token.
    const retryInit = (fetchMock.mock.calls[2] as [string, RequestInit])[1];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer new-tok');

    // The rotated pair was persisted to the cookie store.
    expect(h.setSpy).toHaveBeenCalled();
  });

  it('returns the 401 as a structured error when refresh is impossible', async () => {
    h.cookieHeader = ''; // no refresh cookie -> tryRefresh returns null
    fetchMock.mockResolvedValueOnce(fakeResponse(401, { code: 'unauthorized', message: 'nope' }));

    const result = await apiServerBffSafe('/things', { accessToken: 'stale-tok' });

    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(401);
    expect(result.error?.code).toBe('unauthorized');
    // Only the initial call — no refresh, no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
