/**
 * Lien rule-engine spec — Texas (TX Occupations Code 2303 / Property 70.006).
 * dmv 5 · owner/lienholder wait 30 · NO publication · min 30.
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

const R = LIEN_STATE_RULES.TX;
const ST = 'TX' as const;

describe('lien rules — TX', () => {
  it('buckets value by the TX thresholds', () => {
    expect(computeValueTier(249_999, R)).toBe('low');
    expect(computeValueTier(500_000, R)).toBe('mid');
    expect(computeValueTier(1_000_000, R)).toBe('high');
  });

  it('opens by requesting the DMV lookup, due in 5 days', () => {
    const next = computeNextAction(makeFacts(ST), R, OPENED);
    expect(next.action).toBe('request_dmv_lookup');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 5).toISOString());
  });

  it('sends the owner notice after the lookup completes', () => {
    const next = computeNextAction(
      makeFacts(ST, { currentStep: 'dmv_lookup_complete', dmvLookupCompletedAt: OPENED }),
      R,
      OPENED,
    );
    expect(next.action).toBe('send_owner_notice');
  });

  it('notifies a found lienholder after the owner notice', () => {
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

  it('never requires publication (certified-notice state), even owner-not-found', () => {
    expect(isPublicationRequired(makeFacts(ST, { valueTier: 'mid' }), R)).toBe(false);
    expect(isPublicationRequired(makeFacts(ST, { ownerFound: false }), R)).toBe(false);
  });

  it('skips publication and waits after notices are sent', () => {
    const next = computeNextAction(
      makeFacts(ST, {
        currentStep: 'owner_notice_sent',
        ownerNoticeSentAt: addUtcDays(OPENED, 5),
        lienholderFound: false,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('await_waiting_period');
  });

  it('earliest sale honors the 30-day owner-notice wait', () => {
    const facts = makeFacts(ST, {
      currentStep: 'waiting_period',
      lienholderFound: false,
      ownerNoticeSentAt: addUtcDays(OPENED, 5),
    });
    // max(opened+30, ownerSent+30 = +35) = +35
    expect(computeEarliestSaleDate(facts, R).toISOString()).toBe(
      addUtcDays(OPENED, 35).toISOString(),
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
      makeFacts(ST, { currentStep: 'owner_notice_sent', lienholderResponseAt: OPENED }),
      R,
      OPENED,
    );
    expect(next.action).toBe('resolve_claim');
    expect(next.blocking).toBe(true);
  });
});
