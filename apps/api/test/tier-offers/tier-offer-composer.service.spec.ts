/**
 * TierOfferComposerService unit tests — offer lifecycle + state machine,
 * exercised against the in-memory FakeTierOfferRepository. Asserts the
 * service's transition guards, the send-requires-recipients rule, and that
 * cancel revokes in-flight recipients.
 */
import type { CreateTierOfferPayload } from '@ustowdispatch/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { TierOfferComposerService } from '../../src/modules/tier-offers/tier-offer-composer.service.js';
import { TierOfferTokenService } from '../../src/modules/tier-offers/tier-offer-token.service.js';
import {
  FakeTenantAwareDb,
  FakeTierOfferRepository,
  fakeConfig,
  makeOffer,
  makeRecipient,
} from './fakes.js';

const CTX = { tenantId: 'tenant-1', userId: 'user-1', requestId: 'req-1' };

function build() {
  const repo = new FakeTierOfferRepository();
  const db = new FakeTenantAwareDb();
  const tokens = new TierOfferTokenService(fakeConfig());
  const svc = new TierOfferComposerService(db.asDb(), repo.asRepo(), tokens);
  return { repo, db, svc };
}

const createPayload: CreateTierOfferPayload = {
  tierId: 'tier-1',
  title: 'Memorial Day Surge',
  subjectLine: 'Elevated rate offer',
  narrative: 'Committing trucks for the holiday window.',
  eventWindowStart: '2026-05-25T00:00:00.000Z',
  eventWindowEnd: '2026-05-26T00:00:00.000Z',
  committedTruckCount: 3,
  acceptanceDeadlineAt: '2026-05-24T00:00:00.000Z',
  defaultForNonResponders: 'opt_out',
};

describe('TierOfferComposerService.compose', () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build();
  });

  it('creates a draft offer when the tier exists', async () => {
    const dto = await h.svc.compose(CTX, createPayload);
    expect(dto.status).toBe('draft');
    expect(dto.tierId).toBe('tier-1');
    expect(dto.composedBy).toBe('user-1');
    expect(h.repo.offers.size).toBe(1);
  });

  it('rejects composing against a missing / deleted tier with 400', async () => {
    h.db.seededTier = null;
    await expect(h.svc.compose(CTX, createPayload)).rejects.toMatchObject({
      status: 400,
    });
    expect(h.repo.offers.size).toBe(0);
  });

  it('mints a magic-link token per inline recipient', async () => {
    await h.svc.compose(CTX, {
      ...createPayload,
      recipients: [
        { recipientName: 'A', recipientEmail: 'a@x.example' },
        { recipientName: 'B', recipientEmail: 'b@x.example' },
      ],
    });
    expect(h.repo.recipients.size).toBe(2);
    for (const r of h.repo.recipients.values()) {
      expect(r.status).toBe('pending_send');
      expect(r.magicLinkToken.startsWith('v1.')).toBe(true);
    }
  });
});

describe('TierOfferComposerService.updateDraft', () => {
  it('edits a draft', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    const dto = await h.svc.updateDraft(CTX, offer.id, { title: 'New Title' });
    expect(dto.title).toBe('New Title');
  });

  it('refuses to edit a non-draft offer', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    await expect(h.svc.updateDraft(CTX, offer.id, { title: 'x' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('404s on a missing offer', async () => {
    const h = build();
    await expect(
      h.svc.updateDraft(CTX, 'nope-0000-0000-0000-000000000000', { title: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('TierOfferComposerService.send', () => {
  it('draft → sent and flips pending recipients to sent', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'pending_send' }));
    const dto = await h.svc.send(CTX, offer.id);
    expect(dto.status).toBe('sent');
    expect(dto.sentAt).not.toBeNull();
    const recips = await h.repo.listRecipientsForOffer(null, offer.id);
    expect(recips[0]?.status).toBe('sent');
  });

  it('refuses to send an offer with no recipients', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    await expect(h.svc.send(CTX, offer.id)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to send a non-draft offer (illegal transition)', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'event_concluded' }));
    h.repo.seedRecipient(makeRecipient({ offerId: offer.id }));
    await expect(h.svc.send(CTX, offer.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('TierOfferComposerService transitions', () => {
  it('sent → event_active → event_concluded', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const active = await h.svc.markEventActive(CTX, offer.id);
    expect(active.status).toBe('event_active');
    const concluded = await h.svc.conclude(CTX, offer.id);
    expect(concluded.status).toBe('event_concluded');
  });

  it('rejects markEventActive from draft', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    await expect(h.svc.markEventActive(CTX, offer.id)).rejects.toMatchObject({ status: 409 });
  });

  it('cancel revokes in-flight recipients and freezes terminal ones', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    const inflight = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'sent' }));
    const accepted = h.repo.seedRecipient(makeRecipient({ offerId: offer.id, status: 'accepted' }));
    const dto = await h.svc.cancel(CTX, offer.id, 'weather cleared');
    expect(dto.status).toBe('cancelled');
    expect(dto.cancelledReason).toBe('weather cleared');
    expect(h.repo.recipients.get(inflight.id)?.status).toBe('revoked');
    // An already-accepted recipient is a contractual record — left intact.
    expect(h.repo.recipients.get(accepted.id)?.status).toBe('accepted');
  });

  it('rejects cancel of a concluded offer', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'event_concluded' }));
    await expect(h.svc.cancel(CTX, offer.id, 'x')).rejects.toMatchObject({ status: 409 });
  });
});

describe('TierOfferComposerService.softDelete', () => {
  it('deletes a draft', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'draft' }));
    await h.svc.softDelete(CTX, offer.id);
    expect(h.repo.offers.get(offer.id)?.deletedAt).not.toBeNull();
  });

  it('deletes a cancelled offer', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'cancelled' }));
    await h.svc.softDelete(CTX, offer.id);
    expect(h.repo.offers.get(offer.id)?.deletedAt).not.toBeNull();
  });

  it('refuses to delete a live (sent) offer', async () => {
    const h = build();
    const offer = h.repo.seedOffer(makeOffer({ status: 'sent' }));
    await expect(h.svc.softDelete(CTX, offer.id)).rejects.toMatchObject({ status: 409 });
  });
});
