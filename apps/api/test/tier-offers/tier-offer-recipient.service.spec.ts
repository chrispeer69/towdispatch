/**
 * TierOfferRecipientService unit tests — operator roster surface + the
 * public token-resolved accept/decline path, against in-memory fakes.
 *
 * The public path uses a REAL TierOfferTokenService (same secret on both
 * sides) so token verification actually runs; the FakeTransactionRunner
 * shares the recipients store so admin-pool resolution sees the seeded row.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TierOfferRecipientService } from '../../src/modules/tier-offers/tier-offer-recipient.service.js';
import { TierOfferTokenService } from '../../src/modules/tier-offers/tier-offer-token.service.js';
import {
  FakeTenantAwareDb,
  FakeTierOfferRepository,
  FakeTransactionRunner,
  fakeConfig,
  makeOffer,
  makeRecipient,
} from './fakes.js';

const CTX = { tenantId: 'tenant-1', userId: 'user-1', requestId: 'req-1' };
const FAR_DEADLINE = new Date('2030-01-01T00:00:00.000Z');

function build() {
  const repo = new FakeTierOfferRepository();
  const db = new FakeTenantAwareDb();
  const admin = new FakeTransactionRunner(repo);
  const tokens = new TierOfferTokenService(fakeConfig());
  const svc = new TierOfferRecipientService(db.asDb(), admin.asRunner(), repo.asRepo(), tokens);
  return { repo, db, admin, tokens, svc };
}

describe('TierOfferRecipientService — operator roster', () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build();
  });

  it('adds a recipient (pending_send) to a draft offer', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    const dto = await h.svc.addRecipient(CTX, {
      offerId: offer.id,
      recipientName: 'Jane',
      recipientEmail: 'jane@x.example',
    });
    expect(dto.status).toBe('pending_send');
    expect(dto.magicLinkToken.startsWith('v1.')).toBe(true);
  });

  it('adds a recipient (sent) to an already-sent offer', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const dto = await h.svc.addRecipient(CTX, {
      offerId: offer.id,
      recipientName: 'Late Add',
      recipientEmail: 'late@x.example',
    });
    expect(dto.status).toBe('sent');
  });

  it('refuses to add a recipient to a concluded offer', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'event_concluded' }));
    await expect(
      h.svc.addRecipient(CTX, {
        offerId: offer.id,
        recipientName: 'x',
        recipientEmail: 'x@x.example',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('revokes an in-flight recipient', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const r = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'sent' }));
    const dto = await h.svc.revokeRecipient(CTX, r.id);
    expect(dto.status).toBe('revoked');
  });

  it('refuses to revoke an accepted (terminal) recipient', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const r = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'accepted' }));
    await expect(h.svc.revokeRecipient(CTX, r.id)).rejects.toMatchObject({ status: 409 });
  });

  it('records a manual phone-call response (decline)', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const r = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'sent' }));
    const dto = await h.svc.markManualResponse(CTX, r.id, {
      decision: 'declined',
      declineReason: 'fleet committed elsewhere',
    });
    expect(dto.status).toBe('declined');
    expect(dto.declineReason).toBe('fleet committed elsewhere');
    expect(dto.respondedAt).not.toBeNull();
  });

  it('refuses a manual response on a recipient that already responded', async () => {
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const r = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'accepted' }));
    await expect(
      h.svc.markManualResponse(CTX, r.id, { decision: 'declined' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('TierOfferRecipientService — public token path', () => {
  function seedWithToken(overrides: Parameters<typeof makeRecipient>[0]) {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const recipientId = '0192f8c0-aaaa-7000-8000-000000000001';
    const minted = h.tokens.mint(recipientId, FAR_DEADLINE);
    const recipient = h.repo.seedRecipient(
      makeRecipient({
        id: recipientId,
        offerId: offer.id,
        magicLinkToken: minted.token,
        ...overrides,
      }),
    );
    return { h, offer, recipient, token: minted.token };
  }

  it('resolves a public view for a valid token', async () => {
    const { h, token } = seedWithToken({ status: 'sent' });
    const view = await h.svc.resolvePublicView(token);
    expect(view.offer.title).toBe('Storm Surge — Memorial Day');
    expect(view.recipient.status).toBe('sent');
    expect(view.tenantName).toBe('Acme Towing');
  });

  it('accepts via a valid token and stamps response metadata', async () => {
    const { h, recipient, token } = seedWithToken({ status: 'sent' });
    const res = await h.svc.acceptByToken(token, 'Jane Manager', {
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
    expect(res.status).toBe('accepted');
    const stored = h.repo.recipients.get(recipient.id);
    expect(stored?.status).toBe('accepted');
    expect(stored?.responseIp).toBe('203.0.113.5');
    expect(stored?.notes).toContain('Accepted online by "Jane Manager"');
  });

  it('declines via a valid token with a reason', async () => {
    const { h, recipient, token } = seedWithToken({ status: 'sent' });
    const res = await h.svc.declineByToken(token, 'no trucks available', {
      ipAddress: null,
      userAgent: null,
    });
    expect(res.status).toBe('declined');
    expect(h.repo.recipients.get(recipient.id)?.declineReason).toBe('no trucks available');
  });

  it('is idempotent: re-accepting returns the original response, no error', async () => {
    const { h, token } = seedWithToken({ status: 'accepted' });
    const res = await h.svc.acceptByToken(token, 'Jane', { ipAddress: null, userAgent: null });
    expect(res.status).toBe('accepted');
  });

  it('rejects a conflicting answer after the first response binds', async () => {
    const { h, token } = seedWithToken({ status: 'accepted' });
    await expect(
      h.svc.declineByToken(token, 'changed my mind', { ipAddress: null, userAgent: null }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects responding once the recipient has expired', async () => {
    const { h, token } = seedWithToken({ status: 'expired' });
    await expect(
      h.svc.acceptByToken(token, 'Jane', { ipAddress: null, userAgent: null }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a forged / unknown token with 403', async () => {
    const { h } = seedWithToken({ status: 'sent' });
    await expect(h.svc.resolvePublicView('v1.forged.123.nonce.badsig')).rejects.toMatchObject({
      status: 403,
    });
  });
});
