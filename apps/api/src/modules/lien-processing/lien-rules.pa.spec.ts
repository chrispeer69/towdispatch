/**
 * Lien rule-engine spec — Pennsylvania (75 Pa.C.S. 7301-7305).
 * dmv 7 · owner/lienholder wait 15 · publication +10 (low-value exempt) ·
 * min 30.
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

const R = LIEN_STATE_RULES.PA;
const ST = 'PA' as const;

describe('lien rules — PA', () => {
  it('buckets value by the PA thresholds', () => {
    expect(computeValueTier(249_999, R)).toBe('low');
    expect(computeValueTier(500_000, R)).toBe('mid');
    expect(computeValueTier(1_000_000, R)).toBe('high');
  });

  it('opens by requesting the DMV lookup, due in 7 days', () => {
    const next = computeNextAction(makeFacts(ST), R, OPENED);
    expect(next.action).toBe('request_dmv_lookup');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 7).toISOString());
  });

  it('requires publication for mid, exempts low, requires it when owner not found', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'mid' }), R)).toBe(true);
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'low' }), R)).toBe(false);
    expect(isPublicationRequired(makeFacts(ST, { ownerFound: false }), R)).toBe(true);
  });

  it('publishes after the lienholder notice when one was sent', () => {
    const next = computeNextAction(
      makeFacts(ST, {
        currentStep: 'lienholder_notice_sent',
        ownerNoticeSentAt: OPENED,
        lienholderNoticeSentAt: OPENED,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('publish_notice');
  });

  it('earliest sale honors the publication window', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
      publicationCompletedAt: addUtcDays(OPENED, 40),
    });
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 50).toISOString(),
    );
  });

  it('gates ready-for-sale on the waiting period', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      valueTier: 'low',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
    });
    const earliest = computeEarliestSaleDate(facts, R);
    expect(computeNextAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
      'await_waiting_period',
    );
    expect(computeNextAction(facts, R, earliest).action).toBe('mark_ready_for_sale');
  });

  it('blocks on a recorded claim', () => {
    const next = computeNextAction(
      makeFacts(ST, { currentStep: 'owner_notice_sent', ownerResponseAt: OPENED }),
      R,
      OPENED,
    );
    expect(next.action).toBe('resolve_claim');
  });
});
