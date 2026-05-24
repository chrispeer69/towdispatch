/**
 * Lien rule-engine spec — Florida (FL Statutes 713.78 / 713.585).
 * dmv 7 · owner/lienholder wait 30 · publication +10 (NO low-value exempt) ·
 * min 35.
 */
import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  computeEarliestSaleDate,
  computeNextAction,
  computeValueTier,
  isPublicationRequired,
} from './lien-rules.logic';
import { OPENED, makeFacts } from './lien-rules.scenarios';
import { LIEN_STATE_RULES } from './state-rules.config';

const R = LIEN_STATE_RULES.FL;
const ST = 'FL' as const;

describe('lien rules — FL', () => {
  it('buckets value by the FL thresholds', () => {
    expect(computeValueTier(299_999, R)).toBe('low');
    expect(computeValueTier(600_000, R)).toBe('mid');
    expect(computeValueTier(1_000_000, R)).toBe('high');
  });

  it('opens by requesting the DMV lookup, due in 7 days', () => {
    const next = computeNextAction(makeFacts(ST), R, OPENED);
    expect(next.action).toBe('request_dmv_lookup');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 7).toISOString());
  });

  it('requires publication even for low-value vehicles (no exemption)', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'low' }), R)).toBe(true);
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'mid' }), R)).toBe(true);
  });

  it('publishes after notices when no lienholder remains', () => {
    const next = computeNextAction(
      makeFacts(ST, {
        currentStep: 'owner_notice_sent',
        ownerNoticeSentAt: OPENED,
        lienholderFound: false,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('publish_notice');
  });

  it('earliest sale honors the publication window and the 35-day floor', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
      publicationCompletedAt: addUtcDays(OPENED, 40),
    });
    // max(opened+35, ownerSent+30=+35, pub+10=+50) = +50
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 50).toISOString(),
    );
  });

  it('respects the 35-day minimum when publication is early', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 1),
      publicationCompletedAt: addUtcDays(OPENED, 2),
    });
    // max(opened+35, ownerSent+30=+31, pub+10=+12) = +35
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 35).toISOString(),
    );
  });

  it('gates ready-for-sale on the waiting period', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
      publicationCompletedAt: addUtcDays(OPENED, 6),
    });
    const earliest = computeEarliestSaleDate(facts, R);
    expect(computeNextAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
      'await_waiting_period',
    );
    expect(computeNextAction(facts, R, earliest).action).toBe('mark_ready_for_sale');
  });

  it('blocks on a recorded claim', () => {
    const next = computeNextAction(
      makeFacts(ST, { currentStep: 'publication_complete', ownerResponseAt: OPENED }),
      R,
      OPENED,
    );
    expect(next.action).toBe('resolve_claim');
  });
});
