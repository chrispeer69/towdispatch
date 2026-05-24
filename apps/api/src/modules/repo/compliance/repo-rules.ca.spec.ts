/**
 * Repo rule-engine spec — CA (Rees-Levering 48h notice, 15-day redemption, 60-day PP hold, secondary contact).
 */
import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  computeNextRepoAction,
  computePersonalPropertyHold,
  validatePeacefulRepo,
} from './repo-rules.logic';
import { OPENED, makeAttempt, makeRepoFacts } from './repo-rules.scenarios';
import { REPO_STATE_RULES } from './state-rules.config';

const R = REPO_STATE_RULES.CA;
const ST = 'CA' as const;

describe('repo rules — CA', () => {
  it('config matches the CA statute profile', () => {
    expect(R.postRepoNoticeDays).toBe(2);
    expect(R.redemptionPeriodDays).toBe(15);
    expect(R.cureRightDays).toBe(15);
    expect(R.personalPropertyHoldDays).toBe(60);
    expect(R.preRepoNoticeRequired).toBe(false);
    expect(R.sheriffNoticeRequired).toBe(false);
    expect(R.secondaryContactRequired).toBe(true);
  });

  it('opens by record_recovery', () => {
    const next = computeNextRepoAction(makeRepoFacts(ST), R, OPENED);
    expect(next.action).toBe('record_recovery');
    expect(next.blocking).toBe(true);
    expect(next.statuteCitation).toBe(R.statute);
  });

  it('after recovery, sends the post-repossession notice within 2 days', () => {
    const next = computeNextRepoAction(
      makeRepoFacts(ST, { currentStep: 'recovered', recoveredAt: OPENED.toISOString() }),
      R,
      OPENED,
    );
    expect(next.action).toBe('send_post_repo_notice');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 2).toISOString());
  });

  it('after the post-repo notice, the next gate is notify_secondary_contact', () => {
    const next = computeNextRepoAction(
      makeRepoFacts(ST, {
        currentStep: 'post_repo_notice_sent',
        recoveredAt: OPENED.toISOString(),
        postRepoNoticeSentAt: OPENED.toISOString(),
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('notify_secondary_contact');
  });

  it('gates disposition on the 15-day redemption period', () => {
    const facts = makeRepoFacts(ST, {
      currentStep: 'redemption_period',
      recoveredAt: OPENED.toISOString(),
      postRepoNoticeSentAt: OPENED.toISOString(),
    });
    const earliest = addUtcDays(OPENED, 15);
    expect(computeNextRepoAction(facts, R, addUtcDays(earliest, -1)).action).toBe(
      'await_redemption_period',
    );
    expect(computeNextRepoAction(facts, R, earliest).action).toBe('ready_for_disposition');
  });

  it('holds personal property for 60 days', () => {
    const hold = computePersonalPropertyHold(OPENED, R);
    expect(hold.holdDays).toBe(60);
    expect(hold.holdUntil).toBe(addUtcDays(OPENED, 60).toISOString());
    expect(hold.releaseMethod).toBe('owner_pickup_after_notice');
  });

  it('allows a peaceful repo but flags a debtor objection at the scene', () => {
    expect(validatePeacefulRepo(makeAttempt(ST), R).allowed).toBe(true);
    const objected = validatePeacefulRepo(makeAttempt(ST, { debtorObjected: true }), R);
    expect(objected.allowed).toBe(false);
    expect(objected.violations.length).toBeGreaterThan(0);
  });

  it('blocks on a flagged breach of the peace', () => {
    const next = computeNextRepoAction(
      makeRepoFacts(ST, {
        currentStep: 'recovered',
        recoveredAt: OPENED.toISOString(),
        breachOfPeaceFlagged: true,
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('resolve_breach_flag');
    expect(next.blocking).toBe(true);
  });
});
