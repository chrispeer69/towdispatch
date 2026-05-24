/**
 * Lien rule-engine spec — California (CA Civil Code 3068.1 / Veh Code 22851).
 * dmv 3 · owner/lienholder wait 10 · publication (mid/high) +10 · min 30 ·
 * low-value (<$4,000) publication-exempt.
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

const R = LIEN_STATE_RULES.CA;
const ST = 'CA' as const;

describe('lien rules — CA', () => {
  it('buckets value by the CA thresholds ($4,000 / $10,000)', () => {
    expect(computeValueTier(399_999, R)).toBe('low');
    expect(computeValueTier(700_000, R)).toBe('mid');
    expect(computeValueTier(1_000_000, R)).toBe('high');
    expect(computeValueTier(null, R)).toBe('mid');
  });

  it('opens by requesting the DMV lookup, due in 3 days', () => {
    const next = computeNextAction(makeFacts(ST), R, OPENED);
    expect(next.action).toBe('request_dmv_lookup');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 3).toISOString());
    expect(next.blocking).toBe(true);
  });

  it('after DMV lookup, sends the owner notice', () => {
    const next = computeNextAction(
      makeFacts(ST, { currentStep: 'dmv_lookup_complete', dmvLookupCompletedAt: OPENED }),
      R,
      OPENED,
    );
    expect(next.action).toBe('send_owner_notice');
  });

  it('after owner notice, notifies a found lienholder before publishing', () => {
    const next = computeNextAction(
      makeFacts(ST, {
        currentStep: 'owner_notice_sent',
        ownerNoticeSentAt: OPENED,
        lienholderFound: true,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('send_lienholder_notice');
  });

  it('requires publication for mid-value, exempts low-value', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'mid' }), R)).toBe(true);
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'low' }), R)).toBe(false);
  });

  it('requires publication when the owner cannot be found, even low-value', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'low', ownerFound: false }), R)).toBe(
      true,
    );
  });

  it('earliest sale date honors the publication + min-hold windows', () => {
    const pubAt = addUtcDays(OPENED, 40);
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
      publicationCompletedAt: pubAt,
    });
    // max(opened+30, ownerSent+10=+15, pub+10=+50) = opened+50
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 50).toISOString(),
    );
  });

  it('gates ready-for-sale on the waiting period', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
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
    expect(next.blocking).toBe(true);
  });
});
