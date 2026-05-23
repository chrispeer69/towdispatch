/**
 * Unit tests for the HMAC magic-link token service. No DB, no Nest
 * container — constructs the service with a stub ConfigService.
 */
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '../../config/config.service.js';
import { TierOfferTokenService } from './tier-offer-token.service.js';

function makeService(opts?: { secret?: string; ttlDays?: number }): TierOfferTokenService {
  const stub = {
    tierOffers: {
      cronEnabled: false,
      magicLinkSecret: opts?.secret ?? 'test-secret-32-chars-minimum-aaaaaaaaaa',
      magicLinkTtlDays: opts?.ttlDays ?? 14,
    },
  } as unknown as ConfigService;
  return new TierOfferTokenService(stub);
}

const RECIPIENT_ID = '0192f8c0-1234-7abc-8def-0123456789ab';

describe('TierOfferTokenService', () => {
  it('round-trips a freshly minted token', () => {
    const svc = makeService();
    const deadline = new Date('2026-06-01T00:00:00.000Z');
    const { token, expiresAt } = svc.mint(RECIPIENT_ID, deadline);

    const verified = svc.verify(token, new Date('2026-06-02T00:00:00.000Z'));
    expect(verified).not.toBeNull();
    expect(verified?.recipientId).toBe(RECIPIENT_ID);
    expect(verified?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('keeps the link alive for TTL days past the deadline', () => {
    const svc = makeService({ ttlDays: 14 });
    const deadline = new Date('2026-06-01T00:00:00.000Z');
    const { expiresAt } = svc.mint(RECIPIENT_ID, deadline);
    const expectedMs = deadline.getTime() + 14 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);
  });

  it('rejects a token whose window has fully elapsed', () => {
    const svc = makeService({ ttlDays: 14 });
    const deadline = new Date('2026-06-01T00:00:00.000Z');
    const { token, expiresAt } = svc.mint(RECIPIENT_ID, deadline);
    const oneMsLater = new Date(expiresAt.getTime() + 1);
    expect(svc.verify(token, oneMsLater)).toBeNull();
  });

  it('rejects a token signed with a different secret (tamper / forgery)', () => {
    const minter = makeService({ secret: 'secret-A-padded-to-32-chars-aaaaaaaa' });
    const attacker = makeService({ secret: 'secret-B-padded-to-32-chars-bbbbbbbb' });
    const { token } = minter.mint(RECIPIENT_ID, new Date('2026-06-01T00:00:00.000Z'));
    expect(attacker.verify(token, new Date('2026-06-02T00:00:00.000Z'))).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    const svc = makeService();
    expect(svc.verify('')).toBeNull();
    expect(svc.verify('not-a-token')).toBeNull();
    expect(svc.verify('v1.only.three.parts')).toBeNull();
    expect(svc.verify('v2.aaaa.123.bbbb.cccc')).toBeNull(); // wrong version
  });

  it('rejects a token with a flipped signature byte', () => {
    const svc = makeService();
    const { token } = svc.mint(RECIPIENT_ID, new Date('2026-06-01T00:00:00.000Z'));
    const parts = token.split('.');
    // Corrupt the signature segment.
    parts[4] = `${parts[4]}x`;
    expect(svc.verify(parts.join('.'), new Date('2026-06-02T00:00:00.000Z'))).toBeNull();
  });

  it('mints unique tokens for the same recipient + deadline (nonce)', () => {
    const svc = makeService();
    const deadline = new Date('2026-06-01T00:00:00.000Z');
    const a = svc.mint(RECIPIENT_ID, deadline);
    const b = svc.mint(RECIPIENT_ID, deadline);
    expect(a.token).not.toBe(b.token);
    // …but both still verify to the same recipient.
    const at = new Date('2026-06-02T00:00:00.000Z');
    expect(svc.verify(a.token, at)?.recipientId).toBe(RECIPIENT_ID);
    expect(svc.verify(b.token, at)?.recipientId).toBe(RECIPIENT_ID);
  });
});
