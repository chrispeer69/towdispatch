/**
 * Lien rule-engine spec — Session 35 remaining 40 states + DC.
 *
 * One parameterized suite iterating every state added this session (the 41
 * not covered by the hand-written Session 23 per-state specs). For each it
 * asserts two things:
 *
 *   1. CONFIG SHAPE — the config parses against lienStateRulesSchema and its
 *      numbers are internally consistent (lowMax < highMin, positive hold,
 *      non-negative waits). With 41 hand-entered configs a transposed tier
 *      bound or a negative day-count is the realistic failure mode; this loop
 *      catches all of them.
 *   2. ENGINE BEHAVIOR — the pure rule engine drives the case correctly for
 *      that state's actual day-counts: value-tier bucketing, the opening DMV
 *      action, the owner-found / lienholder-found / publication branches, the
 *      min-days-to-sale boundary, and the claim block.
 *
 * Expectations are DERIVED from each state's config (not hard-coded magic
 * numbers) so the suite validates the engine generically across 41 rule sets
 * without 41 sets of transcribed constants. The 10 Session 23 states keep
 * their bespoke per-state specs (lien-rules.<state>.spec.ts).
 */
import { type LienState, lienStateRulesSchema, lienStateValues } from '@ustowdispatch/shared';
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

// The 10 states shipped in Session 23 — excluded here (they keep their own
// hand-written specs). Everything else is a Session 35 addition.
const SESSION_23 = new Set<LienState>(['CA', 'TX', 'FL', 'NY', 'GA', 'NC', 'OH', 'IL', 'PA', 'MI']);
const remainingStates = lienStateValues.filter((s) => !SESSION_23.has(s));

describe('lien rules — Session 35 remaining states', () => {
  it('covers exactly the 40 remaining states + DC (41 total)', () => {
    expect(remainingStates).toHaveLength(41);
    expect(remainingStates).toContain('DC');
    expect(remainingStates).not.toContain('CA');
  });

  describe.each(remainingStates)('%s', (state) => {
    const R = LIEN_STATE_RULES[state];

    // --- 1. config shape / internal consistency ---------------------------

    it('has a config that parses against the rule schema', () => {
      expect(() => lienStateRulesSchema.parse(R)).not.toThrow();
    });

    it('has internally consistent day-counts and value tiers', () => {
      expect(R.valueTiers.lowMaxCents).toBeLessThan(R.valueTiers.highMinCents);
      expect(R.minDaysToSale).toBeGreaterThan(0);
      expect(R.dmvLookupWindowDays).toBeGreaterThanOrEqual(0);
      expect(R.ownerNoticeWaitDays).toBeGreaterThanOrEqual(0);
      expect(R.lienholderNoticeWaitDays).toBeGreaterThanOrEqual(0);
      // A publication state must carry a wait window; a non-publication state
      // must not (the engine never reads a stray wait it can't reach).
      if (R.publicationRequired) expect(R.publicationWaitDays).toBeGreaterThan(0);
      else expect(R.publicationWaitDays).toBe(0);
      expect(R.statute.length).toBeGreaterThan(8);
    });

    // --- 2. value-tier bucketing -----------------------------------------

    it('buckets value at its own tier boundaries', () => {
      expect(computeValueTier(R.valueTiers.lowMaxCents, R)).toBe('low');
      expect(computeValueTier(R.valueTiers.lowMaxCents + 1, R)).toBe('mid');
      expect(computeValueTier(R.valueTiers.highMinCents, R)).toBe('high');
      // Unknown value defaults to the conservative 'mid' tier.
      expect(computeValueTier(null, R)).toBe('mid');
    });

    // --- 3. opening action ------------------------------------------------

    it('opens by requesting the DMV lookup, due within the lookup window', () => {
      const next = computeNextAction(makeFacts(state), R, OPENED);
      expect(next.action).toBe('request_dmv_lookup');
      expect(next.dueAt?.toISOString()).toBe(
        addUtcDays(OPENED, R.dmvLookupWindowDays).toISOString(),
      );
      expect(next.blocking).toBe(true);
    });

    it('sends the owner notice once the DMV lookup is complete', () => {
      const next = computeNextAction(
        makeFacts(state, { currentStep: 'dmv_lookup_complete', dmvLookupCompletedAt: OPENED }),
        R,
        OPENED,
      );
      expect(next.action).toBe('send_owner_notice');
    });

    // --- 4. publication: value tier + owner-found branches ----------------

    it('matches the state publication rule for mid- and low-value cases', () => {
      // Mid value, owner found → publication iff the state requires it.
      expect(isPublicationRequired(makeFacts(state, { valueTier: 'mid' }), R)).toBe(
        R.publicationRequired,
      );
      // Low value, owner found → publication iff required AND not exempted.
      expect(isPublicationRequired(makeFacts(state, { valueTier: 'low' }), R)).toBe(
        R.publicationRequired && !R.lowValuePublicationExempt,
      );
    });

    it('forces publication when the owner cannot be found (publication states)', () => {
      // Owner not located → publication substitutes for personal notice, but
      // only where the state actually has a publication mechanism.
      expect(
        isPublicationRequired(makeFacts(state, { valueTier: 'low', ownerFound: false }), R),
      ).toBe(R.publicationRequired);
    });

    // --- 5. lienholder branch --------------------------------------------

    it('notifies a found lienholder before publishing / waiting', () => {
      const next = computeNextAction(
        makeFacts(state, {
          currentStep: 'owner_notice_sent',
          ownerNoticeSentAt: OPENED,
          lienholderFound: true,
        }),
        R,
        OPENED,
      );
      expect(next.action).toBe('send_lienholder_notice');
    });

    it('after owner notice with no lienholder, publishes or waits per the state rule', () => {
      const next = computeNextAction(
        makeFacts(state, {
          currentStep: 'owner_notice_sent',
          ownerNoticeSentAt: OPENED,
          lienholderFound: false,
          valueTier: 'mid',
        }),
        R,
        OPENED,
      );
      expect(next.action).toBe(R.publicationRequired ? 'publish_notice' : 'await_waiting_period');
    });

    // --- 6. min-days-to-sale boundary ------------------------------------

    it('gates ready-for-sale on the computed earliest sale date', () => {
      const facts = makeFacts(state, {
        currentStep: 'waiting_period',
        lienholderFound: false,
        ownerNoticeSentAt: OPENED,
        // Pub-required states only fold the publication window in once it is
        // recorded; set it so the boundary reflects the full statutory hold.
        publicationCompletedAt: R.publicationRequired ? OPENED : null,
      });
      const earliest = computeEarliestSaleDate(facts, R);
      // The hold is at least the statutory minimum from opening.
      expect(earliest.getTime()).toBeGreaterThanOrEqual(
        addUtcDays(OPENED, R.minDaysToSale).getTime(),
      );
      expect(computeNextAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
        'await_waiting_period',
      );
      expect(computeNextAction(facts, R, earliest).action).toBe('mark_ready_for_sale');
    });

    // --- 7. claim block ---------------------------------------------------

    it('blocks on a recorded owner claim', () => {
      const next = computeNextAction(
        makeFacts(state, { currentStep: 'owner_notice_sent', ownerResponseAt: OPENED }),
        R,
        OPENED,
      );
      expect(next.action).toBe('resolve_claim');
      expect(next.blocking).toBe(true);
    });
  });
});
