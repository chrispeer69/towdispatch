/**
 * Unit tests for TierOfferEnforcementService.
 *
 * The service does pure read work — given a Drizzle tx and a (tenantId,
 * accountId, jobStartedAt) tuple, it walks at most two tables and returns
 * one of four resolution shapes. We mock the tx with a tiny stub so the
 * tests don't need a live Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TierOfferEnforcementService } from './tier-offer-enforcement.service.js';

interface FakeOffer {
  id: string;
  tenantId: string;
  status: string;
  tierId: string;
  eventWindowStart: Date;
  eventWindowEnd: Date;
}
interface FakeRecipient {
  id: string;
  tenantId: string;
  offerId: string;
  accountId: string | null;
  status: string;
}

function buildFakeTx(state: { offer?: FakeOffer | null; recipient?: FakeRecipient | null }) {
  return {
    query: {
      tierOffers: {
        findFirst: vi.fn().mockResolvedValue(state.offer ?? null),
      },
      tierOfferRecipients: {
        findFirst: vi.fn().mockResolvedValue(state.recipient ?? null),
      },
    },
  };
}

describe('TierOfferEnforcementService.resolveForJob', () => {
  let service: TierOfferEnforcementService;

  beforeEach(() => {
    // The service constructor takes TenantAwareDb but never uses it for the
    // resolveForJob path (we pass `tx` directly). A typed-cast `any` keeps
    // the test infrastructure-light.
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    service = new TierOfferEnforcementService(undefined as any);
  });

  const tenantId = '00000000-0000-0000-0000-00000000aaaa';
  const accountId = '00000000-0000-0000-0000-00000000bbbb';
  const offerId = '00000000-0000-0000-0000-00000000cccc';
  const tierId = '00000000-0000-0000-0000-00000000dddd';
  const recipientId = '00000000-0000-0000-0000-00000000eeee';
  const jobStartedAt = new Date('2026-12-21T18:00:00Z');

  function activeOffer(status = 'sent', delta = 0): FakeOffer {
    return {
      id: offerId,
      tenantId,
      tierId,
      status,
      eventWindowStart: new Date(jobStartedAt.getTime() - 60 * 60 * 1000 + delta),
      eventWindowEnd: new Date(jobStartedAt.getTime() + 60 * 60 * 1000 + delta),
    };
  }

  it('returns no_active_offer when accountId is null (cash job)', async () => {
    const tx = buildFakeTx({});
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, {
      tenantId,
      accountId: null,
      jobStartedAt,
    });
    expect(out).toEqual({ kind: 'no_active_offer' });
    expect(tx.query.tierOffers.findFirst).not.toHaveBeenCalled();
  });

  it('returns no_active_offer when no covering offer exists', async () => {
    const tx = buildFakeTx({ offer: null });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'no_active_offer' });
  });

  it('returns no_active_offer when the covering offer is in draft state', async () => {
    const tx = buildFakeTx({ offer: activeOffer('draft') });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'no_active_offer' });
  });

  it('returns no_active_offer when the covering offer is cancelled', async () => {
    const tx = buildFakeTx({ offer: activeOffer('cancelled') });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'no_active_offer' });
  });

  it('returns no_active_offer when no recipient row exists for that account', async () => {
    const tx = buildFakeTx({ offer: activeOffer('sent'), recipient: null });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'no_active_offer' });
  });

  it('returns accepted when the recipient has accepted the offer', async () => {
    const tx = buildFakeTx({
      offer: activeOffer('event_active'),
      recipient: {
        id: recipientId,
        tenantId,
        offerId,
        accountId,
        status: 'accepted',
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'accepted', offerId, recipientId, tierId });
  });

  it('returns declined when the recipient has declined the offer', async () => {
    const tx = buildFakeTx({
      offer: activeOffer('sent'),
      recipient: {
        id: recipientId,
        tenantId,
        offerId,
        accountId,
        status: 'declined',
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: stub tx
    const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
    expect(out).toEqual({ kind: 'declined', offerId, recipientId });
  });

  it('returns declined for expired / revoked / bounced statuses', async () => {
    for (const status of ['expired', 'revoked', 'bounced']) {
      const tx = buildFakeTx({
        offer: activeOffer('sent'),
        recipient: {
          id: recipientId,
          tenantId,
          offerId,
          accountId,
          status,
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: stub tx
      const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
      expect(out).toEqual({ kind: 'declined', offerId, recipientId });
    }
  });

  it('returns pending when the recipient has not yet responded', async () => {
    for (const status of ['pending_send', 'sent', 'delivered', 'opened']) {
      const tx = buildFakeTx({
        offer: activeOffer('sent'),
        recipient: {
          id: recipientId,
          tenantId,
          offerId,
          accountId,
          status,
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: stub tx
      const out = await service.resolveForJob(tx as any, { tenantId, accountId, jobStartedAt });
      expect(out).toEqual({ kind: 'pending', offerId, recipientId });
    }
  });
});
