/**
 * Repo-compliance rule-engine integration spec (Session 51).
 *
 * Drives a repossession case through its full compliance lifecycle for five
 * representative states — WA, HI, MD (non-cure self-help) and MO, MA (cure
 * states, the latter with the longest 21-day cure) — asserting the exact
 * action sequence and the redemption boundary end-to-end, not just the
 * isolated branches the parameterized suite covers.
 *
 * It also runs lightweight property reps: across many pseudo-random values
 * and day-offsets, value-tier bucketing stays monotonic and an opened case is
 * always blocking. Uses a seeded RNG so failures are reproducible (no extra
 * dependency).
 */
import type { RepoState } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  computeEarliestDispositionDate,
  computeNextAction,
  computeValueTier,
} from './repo-rules.logic';
import { OPENED, makeFacts } from './repo-rules.scenarios';
import { REPO_STATE_RULES } from './state-rules.config';

const SAMPLE: RepoState[] = ['WA', 'HI', 'MD', 'MO', 'MA'];

describe('repo rules — full-lifecycle integration', () => {
  describe.each(SAMPLE)('%s end-to-end', (state) => {
    const R = REPO_STATE_RULES[state];

    it('walks opened → ready_for_disposition in statutory order', () => {
      // 1. Opening.
      let facts = makeFacts(state, { valueTier: 'mid' });
      const opening = computeNextAction(facts, R, OPENED);

      // 2. Cure states send + wait out the right-to-cure notice first.
      if (R.preRepoNoticeRequired) {
        expect(opening.action).toBe('send_pre_repo_notice');
        facts = { ...facts, currentStep: 'pre_repo_notice_sent', defaultNoticeSentAt: OPENED };
        const cureEnds = addUtcDays(OPENED, R.preRepoNoticeDays);
        expect(computeNextAction(facts, R, OPENED).action).toBe('await_cure_period');
        expect(computeNextAction(facts, R, cureEnds).action).toBe('complete_repossession');
      } else {
        expect(opening.action).toBe('complete_repossession');
      }

      // 3. Repossession recorded → secure personal property.
      const repoDate = R.preRepoNoticeRequired ? addUtcDays(OPENED, R.preRepoNoticeDays) : OPENED;
      facts = { ...facts, currentStep: 'repossessed', repossessedAt: repoDate };
      expect(computeNextAction(facts, R, repoDate).action).toBe('secure_personal_property');

      // 4. Property secured → send the post-repossession notice.
      facts = { ...facts, personalPropertySecuredAt: repoDate };
      expect(computeNextAction(facts, R, repoDate).action).toBe('send_post_repo_notice');

      // 5. Notice sent → wait out the redemption / notice period.
      facts = {
        ...facts,
        currentStep: 'redemption_period',
        postRepoNoticeSentAt: repoDate,
      };
      const earliest = computeEarliestDispositionDate(facts, R);
      expect(earliest.getTime()).toBeGreaterThanOrEqual(
        addUtcDays(repoDate, R.redemptionDays).getTime(),
      );
      expect(computeNextAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
        'await_redemption_period',
      );
      expect(computeNextAction(facts, R, earliest).action).toBe('mark_ready_for_disposition');

      // 6. Marked ready → conduct disposition (operator action, non-blocking).
      facts = { ...facts, status: 'ready_for_disposition', currentStep: 'ready_for_disposition' };
      const ready = computeNextAction(facts, R, earliest);
      expect(ready.action).toBe('conduct_disposition');
      expect(ready.blocking).toBe(false);

      // 7. Disposed (mid value) → deficiency explanation if required.
      facts = { ...facts, status: 'disposed', currentStep: 'disposed' };
      expect(computeNextAction(facts, R, earliest).action).toBe(
        R.deficiencyNoticeRequired ? 'send_deficiency_notice' : 'none',
      );
    });

    it('a recorded dispute blocks disposition at any pre-terminal step', () => {
      for (const step of ['repossessed', 'post_repo_notice_sent', 'redemption_period'] as const) {
        const next = computeNextAction(
          makeFacts(state, { currentStep: step, repossessedAt: OPENED, debtorResponseAt: OPENED }),
          R,
          OPENED,
        );
        expect(next.action).toBe('resolve_claim');
        expect(next.blocking).toBe(true);
      }
    });

    it('property reps: value bucketing is monotonic and opens are blocking', () => {
      // Deterministic LCG so any failure reproduces.
      let seed = 0x51_51_51 + state.charCodeAt(0);
      const rand = () => {
        seed = (seed * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff;
        return seed / 0x7f_ff_ff_ff;
      };
      for (let i = 0; i < 200; i++) {
        const cents = Math.floor(rand() * 2_000_000);
        const tier = computeValueTier(cents, R);
        if (cents <= R.valueTiers.lowMaxCents) expect(tier).toBe('low');
        else if (cents >= R.valueTiers.highMinCents) expect(tier).toBe('high');
        else expect(tier).toBe('mid');

        // A freshly opened case is always blocking regardless of value tier.
        const opened = computeNextAction(makeFacts(state, { valueTier: tier }), R, OPENED);
        expect(opened.blocking).toBe(true);
      }
    });
  });
});
