import { describe, expect, it } from 'vitest';
import { buildCsp } from '../../csp.mjs';

/**
 * R-12. The header is built from a pure function so we can assert the exact
 * directives without booting Next or a browser.
 */
describe('buildCsp', () => {
  const csp = buildCsp({
    NEXT_PUBLIC_API_URL: 'https://api.towcommand.cloud',
    NODE_ENV: 'production',
  });

  /** Pull a single directive's value out of the policy string. */
  const directive = (name: string): string =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d === name || d.startsWith(`${name} `)) ?? '';

  it('locks down framing, base-uri, and plugins', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
  });

  it('allows the inline + eval scripts Next and Mapbox require', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it('derives the API origin and wss scheme from NEXT_PUBLIC_API_URL', () => {
    const connectSrc = directive('connect-src');
    expect(connectSrc).toContain('https://api.towcommand.cloud');
    expect(connectSrc).toContain('wss://api.towcommand.cloud');
    expect(connectSrc).toContain('https://*.ingest.sentry.io');
  });

  it('permits data, blob, and cloudfront images', () => {
    const imgSrc = directive('img-src');
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
    expect(imgSrc).toContain('https://*.cloudfront.net');
  });

  it('upgrades insecure requests', () => {
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('uses the ws:// scheme for an http (local) API origin', () => {
    const devCsp = buildCsp({ NEXT_PUBLIC_API_URL: 'http://localhost:3001' });
    expect(directiveOf(devCsp, 'connect-src')).toContain('ws://localhost:3001');
  });

  it('still emits a valid policy when the API URL is absent', () => {
    const bare = buildCsp({});
    expect(bare).toContain("default-src 'self'");
    expect(bare).toContain('upgrade-insecure-requests');
  });
});

function directiveOf(csp: string, name: string): string {
  return (
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d === name || d.startsWith(`${name} `)) ?? ''
  );
}
