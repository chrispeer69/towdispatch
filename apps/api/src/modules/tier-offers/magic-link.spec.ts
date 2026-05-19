import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signMagicLink, verifyMagicLink } from './magic-link.js';

const SECRET = 'tier-offer-magic-link-test-secret-do-not-use-in-production';

describe('tier-offer magic-link', () => {
  it('round-trips a freshly signed token', async () => {
    const { token, expiresAt } = await signMagicLink(
      {
        recipientId: '00000000-0000-0000-0000-000000000001',
        offerId: '00000000-0000-0000-0000-000000000002',
        tenantId: '00000000-0000-0000-0000-000000000003',
      },
      3600,
      SECRET,
    );
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const decoded = await verifyMagicLink(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.recipientId).toBe('00000000-0000-0000-0000-000000000001');
    expect(decoded?.offerId).toBe('00000000-0000-0000-0000-000000000002');
    expect(decoded?.tenantId).toBe('00000000-0000-0000-0000-000000000003');
  });

  it('rejects an empty / missing token', async () => {
    expect(await verifyMagicLink(undefined, SECRET)).toBeNull();
    expect(await verifyMagicLink(null, SECRET)).toBeNull();
    expect(await verifyMagicLink('', SECRET)).toBeNull();
  });

  it('rejects a token with a tampered signature', async () => {
    const { token } = await signMagicLink(
      {
        recipientId: '00000000-0000-0000-0000-000000000001',
        offerId: '00000000-0000-0000-0000-000000000002',
        tenantId: '00000000-0000-0000-0000-000000000003',
      },
      3600,
      SECRET,
    );
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    const bogus = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(await verifyMagicLink(bogus, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    // Sign a token whose exp is already in the past by crafting it manually.
    const secret = new TextEncoder().encode(SECRET);
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({
      recipientId: '00000000-0000-0000-0000-000000000001',
      offerId: '00000000-0000-0000-0000-000000000002',
      tenantId: '00000000-0000-0000-0000-000000000003',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .setAudience('tier-offer-magic-link')
      .sign(secret);
    expect(await verifyMagicLink(token, SECRET)).toBeNull();
  });

  it('rejects a token signed with the wrong audience', async () => {
    const secret = new TextEncoder().encode(SECRET);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await new SignJWT({
      recipientId: '00000000-0000-0000-0000-000000000001',
      offerId: '00000000-0000-0000-0000-000000000002',
      tenantId: '00000000-0000-0000-0000-000000000003',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(exp)
      .setAudience('some-other-feature')
      .sign(secret);
    expect(await verifyMagicLink(token, SECRET)).toBeNull();
  });

  it('rejects when JWT_SECRET differs from signing secret', async () => {
    const { token } = await signMagicLink(
      {
        recipientId: '00000000-0000-0000-0000-000000000001',
        offerId: '00000000-0000-0000-0000-000000000002',
        tenantId: '00000000-0000-0000-0000-000000000003',
      },
      3600,
      SECRET,
    );
    expect(await verifyMagicLink(token, 'totally-different-secret-1234567890abcdef')).toBeNull();
  });
});
