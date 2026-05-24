/**
 * Unit tests (no DB) for the White-Label Customer Portal (Session 32):
 *   - Host → tenant-slug parsing (custom domain vs <slug>.portal.<base>).
 *   - Portal JWT keyspace isolation: a portal token must NOT verify as an
 *     operator or driver token, and vice-versa.
 */
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service.js';
import { JwtService } from '../src/modules/auth/jwt.service.js';
import {
  buildPortalUrl,
  extractSubdomainSlug,
  normalizeHost,
} from '../src/modules/customer-portal/portal-host.util.js';

describe('portal host parsing', () => {
  it('normalizeHost strips port and www., lowercases', () => {
    expect(normalizeHost('Portal.Acme-Towing.com:443')).toBe('portal.acme-towing.com');
    expect(normalizeHost('www.acme.portal.towcommand.cloud')).toBe('acme.portal.towcommand.cloud');
    expect(normalizeHost('   ')).toBe('');
  });

  it('extractSubdomainSlug pulls the single-label slug under the base', () => {
    expect(extractSubdomainSlug('acme.portal.towcommand.cloud', 'portal.towcommand.cloud')).toBe(
      'acme',
    );
  });

  it('extractSubdomainSlug rejects the bare base and multi-label prefixes', () => {
    expect(extractSubdomainSlug('portal.towcommand.cloud', 'portal.towcommand.cloud')).toBeNull();
    expect(
      extractSubdomainSlug('a.b.portal.towcommand.cloud', 'portal.towcommand.cloud'),
    ).toBeNull();
    expect(extractSubdomainSlug('acme.example.com', 'portal.towcommand.cloud')).toBeNull();
  });

  it('buildPortalUrl uses http for local hosts and https otherwise', () => {
    expect(buildPortalUrl('localhost:3000', '/portal/verify-email', 'tok en')).toBe(
      'http://localhost:3000/portal/verify-email?token=tok%20en',
    );
    expect(buildPortalUrl('portal.acme-towing.com', '/portal/reset-password', 'abc')).toBe(
      'https://portal.acme-towing.com/portal/reset-password?token=abc',
    );
  });
});

describe('portal JWT keyspace isolation', () => {
  // Minimal config: JwtService only reads config.jwt.*. Distinct secrets per
  // audience mirror the production domain-separation (::access / ::portal / …).
  const fakeConfig = {
    jwt: {
      accessSecret: 'access-secret-key-至少-32-chars-padding-xxxx',
      refreshSecret: 'refresh-secret-key-at-least-32-chars-padding',
      mfaSecret: 'mfa-secret-key-at-least-32-characters-padding',
      driverSecret: 'driver-secret-key-at-least-32-chars-padding-x',
      portalSecret: 'portal-secret-key-at-least-32-chars-padding-x',
      accessTtl: '15m',
      refreshTtl: '30d',
      driverTtl: '12h',
      portalTtl: '24h',
      issuer: 'ustowdispatch',
      audience: 'ustowdispatch-api',
    },
  } as unknown as ConfigService;

  const jwt = new JwtService(fakeConfig);

  it('a portal token verifies as a portal token with the right claims', async () => {
    const token = await jwt.signPortal({ sub: 'pu-1', cid: 'cust-1', tid: 'tenant-1', jti: 'j1' });
    const claims = await jwt.verifyPortal(token);
    expect(claims.sub).toBe('pu-1');
    expect(claims.cid).toBe('cust-1');
    expect(claims.tid).toBe('tenant-1');
  });

  it('a portal token is rejected by the operator and driver verifiers', async () => {
    const token = await jwt.signPortal({ sub: 'pu-1', cid: 'cust-1', tid: 'tenant-1', jti: 'j1' });
    await expect(jwt.verifyAccess(token)).rejects.toThrow();
    await expect(jwt.verifyDriver(token)).rejects.toThrow();
  });

  it('an operator access token is rejected by the portal verifier', async () => {
    const op = await jwt.signAccess({ sub: 'user-1', tid: 'tenant-1', role: 'owner', jti: 'j2' });
    await expect(jwt.verifyPortal(op)).rejects.toThrow();
  });
});
