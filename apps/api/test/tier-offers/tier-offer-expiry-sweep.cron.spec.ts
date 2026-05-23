/**
 * TierOfferExpirySweepCron unit tests — env-gate behavior + the sweep's
 * idempotency, against in-memory fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TierOfferExpirySweepCron } from '../../src/modules/tier-offers/tier-offer-expiry-sweep.cron.js';
import {
  FakeTenantAwareDb,
  FakeTierOfferRepository,
  FakeTransactionRunner,
  fakeConfig,
  makeRecipient,
} from './fakes.js';

const PAST = new Date('2026-05-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const NOW = new Date('2026-06-01T00:00:00.000Z');

function build(cronEnabled: boolean) {
  const repo = new FakeTierOfferRepository();
  const db = new FakeTenantAwareDb();
  const admin = new FakeTransactionRunner(repo);
  const config = fakeConfig({ cronEnabled });
  const cron = new TierOfferExpirySweepCron(db.asDb(), admin.asRunner(), config, repo.asRepo());
  return { repo, db, admin, cron };
}

describe('TierOfferExpirySweepCron — gate flag', () => {
  it('tick() is a no-op when TIER_OFFER_CRON_ENABLED is false', async () => {
    const h = build(false);
    const spy = vi.spyOn(h.admin, 'runAsAdmin');
    await h.cron.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it('tick() runs the sweep when the flag is true', async () => {
    const h = build(true);
    const spy = vi.spyOn(h.admin, 'runAsAdmin');
    await h.cron.tick();
    expect(spy).toHaveBeenCalled();
  });
});

describe('TierOfferExpirySweepCron — sweep', () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build(true);
  });

  it('expires only in-flight recipients past their TTL', async () => {
    const expired = h.repo.seedRecipient(
      makeRecipient({ status: 'sent', magicLinkExpiresAt: PAST }),
    );
    const stillLive = h.repo.seedRecipient(
      makeRecipient({ status: 'sent', magicLinkExpiresAt: FUTURE }),
    );
    const alreadyAccepted = h.repo.seedRecipient(
      makeRecipient({ status: 'accepted', magicLinkExpiresAt: PAST }),
    );

    const { expiredCount } = await h.cron.runForAllTenants(NOW);

    expect(expiredCount).toBe(1);
    expect(h.repo.recipients.get(expired.id)?.status).toBe('expired');
    expect(h.repo.recipients.get(stillLive.id)?.status).toBe('sent');
    // A terminal recipient is never touched even if its link has lapsed.
    expect(h.repo.recipients.get(alreadyAccepted.id)?.status).toBe('accepted');
  });

  it('is idempotent — a second run expires nothing more', async () => {
    h.repo.seedRecipient(makeRecipient({ status: 'sent', magicLinkExpiresAt: PAST }));
    const first = await h.cron.runForAllTenants(NOW);
    const second = await h.cron.runForAllTenants(NOW);
    expect(first.expiredCount).toBe(1);
    expect(second.expiredCount).toBe(0);
  });

  it('expires delivered and opened recipients too', async () => {
    h.repo.seedRecipient(makeRecipient({ status: 'delivered', magicLinkExpiresAt: PAST }));
    h.repo.seedRecipient(makeRecipient({ status: 'opened', magicLinkExpiresAt: PAST }));
    const { expiredCount } = await h.cron.runForAllTenants(NOW);
    expect(expiredCount).toBe(2);
  });
});
