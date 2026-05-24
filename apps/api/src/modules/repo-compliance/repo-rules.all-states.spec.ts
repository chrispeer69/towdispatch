/**
 * Repo-compliance rule-engine spec — all 50 states + DC (Session 51).
 *
 * One parameterized suite iterating every jurisdiction. For each it asserts:
 *
 *   1. CONFIG SHAPE — the config parses against repoStateRulesSchema and its
 *      numbers are internally consistent (lowMax < highMin, positive
 *      notice/redemption windows, the pre-repo-notice coupling). With 51
 *      hand-entered configs a transposed tier bound or a stray day-count is
 *      the realistic failure mode; this loop catches all of them.
 *   2. ENGINE BEHAVIOR — the pure rule engine drives the case correctly for
 *      that state's actual day-counts: value-tier bucketing, the opening
 *      action (cure-notice vs immediate repossession), the cure-period gate,
 *      the personal-property + post-repo-notice sequence, the redemption
 *      boundary, the deficiency branch, and the dispute block.
 *
 * Expectations are DERIVED from each state's config (not hard-coded magic
 * numbers) so the suite validates the engine generically across 51 rule sets.
 */
import { type RepoState, repoStateRulesSchema, repoStateValues } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  computeEarliestDispositionDate,
  computeNextAction,
  computeValueTier,
} from './repo-rules.logic';
import { OPENED, makeFacts } from './repo-rules.scenarios';
import { REPO_STATE_RULES } from './state-rules.config';

describe('repo rules — all states', () => {
  it('covers exactly 50 states + DC (51 total)', () => {
    expect(repoStateValues).toHaveLength(51);
    expect(repoStateValues).toContain('DC');
    expect(new Set(repoStateValues).size).toBe(51);
  });

  it('has a config entry for every state value', () => {
    for (const s of repoStateValues) {
      expect(REPO_STATE_RULES[s]).toBeDefined();
    }
    expect(Object.keys(REPO_STATE_RULES)).toHaveLength(51);
  });

  describe.each(repoStateValues)('%s', (state: RepoState) => {
    const R = REPO_STATE_RULES[state];

    // --- 1. config shape / internal consistency ---------------------------

    it('has a config that parses against the rule schema', () => {
      expect(() => repoStateRulesSchema.parse(R)).not.toThrow();
    });

    it('has internally consistent day-counts and value tiers', () => {
      expect(R.valueTiers.lowMaxCents).toBeLessThan(R.valueTiers.highMinCents);
      expect(R.postRepoNoticeDays).toBeGreaterThan(0);
      expect(R.redemptionDays).toBeGreaterThan(0);
      expect(R.personalPropertyHoldDays).toBeGreaterThanOrEqual(0);
      // A cure state must carry a positive cure window; a non-cure state must
      // not (the engine never reads a stray window it can't reach).
      if (R.preRepoNoticeRequired) expect(R.preRepoNoticeDays).toBeGreaterThan(0);
      else expect(R.preRepoNoticeDays).toBe(0);
      expect(R.statute.length).toBeGreaterThan(8);
      expect(R.breachOfPeaceStandard.length).toBeGreaterThan(8);
    });

    // --- 2. value-tier bucketing -----------------------------------------

    it('buckets value at its own tier boundaries', () => {
      expect(computeValueTier(R.valueTiers.lowMaxCents, R)).toBe('low');
      expect(computeValueTier(R.valueTiers.lowMaxCents + 1, R)).toBe('mid');
      expect(computeValueTier(R.valueTiers.highMinCents, R)).toBe('high');
      // Unknown value defaults to the conservative 'mid' tier.
      expect(computeValueTier(null, R)).toBe('mid');
    });

    // --- 3. opening action: cure notice vs immediate repossession ---------

    it('opens with the cure notice (cure states) or repossession (others)', () => {
      const next = computeNextAction(makeFacts(state), R, OPENED);
      expect(next.action).toBe(
        R.preRepoNoticeRequired ? 'send_pre_repo_notice' : 'complete_repossession',
      );
      expect(next.blocking).toBe(true);
    });

    // --- 4. cure-period gate (cure states only) ---------------------------

    it('gates repossession on the cure period in cure states', () => {
      if (!R.preRepoNoticeRequired) return;
      const facts = makeFacts(state, {
        currentStep: 'pre_repo_notice_sent',
        defaultNoticeSentAt: OPENED,
      });
      const cureEnds = addUtcDays(OPENED, R.preRepoNoticeDays);
      const pending = computeNextAction(facts, R, OPENED);
      expect(pending.action).toBe('await_cure_period');
      expect(pending.dueAt?.toISOString()).toBe(cureEnds.toISOString());
      // Once the cure period elapses, repossession may proceed.
      expect(computeNextAction(facts, R, cureEnds).action).toBe('complete_repossession');
    });

    // --- 5. post-repossession sequence -----------------------------------

    it('secures personal property then sends the post-repo notice', () => {
      const secured = computeNextAction(
        makeFacts(state, { currentStep: 'repossessed', repossessedAt: OPENED }),
        R,
        OPENED,
      );
      expect(secured.action).toBe('secure_personal_property');

      const notice = computeNextAction(
        makeFacts(state, {
          currentStep: 'repossessed',
          repossessedAt: OPENED,
          personalPropertySecuredAt: OPENED,
        }),
        R,
        OPENED,
      );
      expect(notice.action).toBe('send_post_repo_notice');
    });

    // --- 6. redemption boundary ------------------------------------------

    it('gates ready-for-disposition on the computed earliest date', () => {
      const facts = makeFacts(state, {
        currentStep: 'redemption_period',
        repossessedAt: OPENED,
        personalPropertySecuredAt: OPENED,
        postRepoNoticeSentAt: OPENED,
      });
      const earliest = computeEarliestDispositionDate(facts, R);
      // The hold is at least the redemption window from repossession.
      expect(earliest.getTime()).toBeGreaterThanOrEqual(
        addUtcDays(OPENED, R.redemptionDays).getTime(),
      );
      expect(computeNextAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
        'await_redemption_period',
      );
      expect(computeNextAction(facts, R, earliest).action).toBe('mark_ready_for_disposition');
    });

    // --- 7. ready-for-disposition + deficiency branch --------------------

    it('recommends disposition once ready, then the deficiency notice', () => {
      const ready = computeNextAction(
        makeFacts(state, { status: 'ready_for_disposition', currentStep: 'ready_for_disposition' }),
        R,
        OPENED,
      );
      expect(ready.action).toBe('conduct_disposition');
      expect(ready.blocking).toBe(false);

      const disposedMid = computeNextAction(
        makeFacts(state, { status: 'disposed', currentStep: 'disposed', valueTier: 'mid' }),
        R,
        OPENED,
      );
      expect(disposedMid.action).toBe(
        R.deficiencyNoticeRequired ? 'send_deficiency_notice' : 'none',
      );

      // Low-value collateral: deficiency is not pursued (product heuristic).
      const disposedLow = computeNextAction(
        makeFacts(state, { status: 'disposed', currentStep: 'disposed', valueTier: 'low' }),
        R,
        OPENED,
      );
      expect(disposedLow.action).toBe('none');
    });

    // --- 8. dispute block -------------------------------------------------

    it('blocks on a recorded debtor dispute', () => {
      const next = computeNextAction(
        makeFacts(state, {
          currentStep: 'repossessed',
          repossessedAt: OPENED,
          debtorResponseAt: OPENED,
        }),
        R,
        OPENED,
      );
      expect(next.action).toBe('resolve_claim');
      expect(next.blocking).toBe(true);
    });
  });
});
