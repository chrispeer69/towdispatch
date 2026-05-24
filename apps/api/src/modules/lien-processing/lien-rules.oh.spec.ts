/**
 * Lien rule-engine spec — Ohio (OH Rev Code 4505.101 / 4513.60-.62).
 * dmv 5 · owner/lienholder wait 15 · NO publication · min 30.
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

const R = LIEN_STATE_RULES.OH;
const ST = 'OH' as const;

describe('lien rules — OH', () => {
  it('buckets value by the OH thresholds', () => {
    expect(computeValueTier(249_999, R)).toBe('low');
    expect(computeValueTier(500_000, R)).toBe('mid');
    expect(computeValueTier(1_000_000, R)).toBe('high');
  });

  it('opens by requesting the DMV lookup, due in 5 days', () => {
    const next = computeNextAction(makeFacts(ST), R, OPENED);
    expect(next.action).toBe('request_dmv_lookup');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 5).toISOString());
  });

  it('never requires publication (certified-notice state)', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'mid' }), R)).toBe(false);
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'high', ownerFound: false }), R)).toBe(
      false,
    );
  });

  it('waits after the owner notice when no lienholder remains (no publication)', () => {
    const next = computeNextAction(
      makeFacts(ST, {
        currentStep: 'owner_notice_sent',
        ownerNoticeSentAt: addUtcDays(OPENED, 3),
        lienholderFound: false,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('await_waiting_period');
  });

  it('earliest sale honors the 30-day floor when notices are early', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 3),
    });
    // max(opened+30, ownerSent+15=+18) = +30
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 30).toISOString(),
    );
  });

  it('gates ready-for-sale on the waiting period', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 20),
    });
    const earliest = computeEarliestSaleDate(facts, R);
    // ownerSent(+20)+15 = +35 dominates the 30-day floor
    expect(earliest.toISOString()).toBe(addUtcDays(OPENED, 35).toISOString());
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
