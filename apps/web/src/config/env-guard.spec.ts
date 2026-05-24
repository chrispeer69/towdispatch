import { describe, expect, it } from 'vitest';
import { assertPublicApiUrl } from '../../env-guard.mjs';

/**
 * R-14 build-time guard. Drives the exact branches next.config.mjs relies on.
 */
describe('assertPublicApiUrl', () => {
  it('returns the configured URL when set (production)', () => {
    expect(
      assertPublicApiUrl({
        NEXT_PUBLIC_API_URL: 'https://api.towcommand.cloud',
        NODE_ENV: 'production',
      }),
    ).toBe('https://api.towcommand.cloud');
  });

  it('falls back to localhost in development when unset', () => {
    expect(assertPublicApiUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3001');
  });

  it('throws in a production-like build when unset', () => {
    expect(() => assertPublicApiUrl({ NODE_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_API_URL is required/,
    );
  });

  it('treats an undefined NODE_ENV as non-development and throws', () => {
    expect(() => assertPublicApiUrl({})).toThrow(/NEXT_PUBLIC_API_URL is required/);
  });

  it('treats NODE_ENV=test as non-development and throws when unset', () => {
    expect(() => assertPublicApiUrl({ NODE_ENV: 'test' })).toThrow(
      /NEXT_PUBLIC_API_URL is required/,
    );
  });
});
