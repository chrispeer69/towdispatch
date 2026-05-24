/**
 * Repo rule-engine spec — GA (OCGA 11-9-609 + 10-1-36 deficiency notice).
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

const R = REPO_STATE_RULES.GA;
const ST = 'GA' as const;

describe('repo rules — GA', () => {
  it('config matches the GA statute profile', () => {
    expect(R.postRepoNoticeDays).toBe(10);
    expect(R.redemptionPeriodDays).toBe(0);
    expect(R.cureRightDays).toBe(10);
    expect(R.personalPropertyHoldDays).toBe(30);
    expect(R.preRepoNoticeRequired).toBe(false);
    expect(R.sheriffNoticeRequired).toBe(false);
    expect(R.secondaryContactRequired).toBe(false);
  });

  it('opens by record_recovery', () => {
    const next = computeNextRepoAction(makeRepoFacts(ST), R, OPENED);
    expect(next.action).toBe('record_recovery');
    expect(next.blocking).toBe(true);
    expect(next.statuteCitation).toBe(R.statute);
  });

  it('after recovery, sends the post-repossession notice within 10 days', () => {
    const next = computeNextRepoAction(
      makeRepoFacts(ST, { currentStep: 'recovered', recoveredAt: OPENED.toISOString() }),
      R,
      OPENED,
    );
    expect(next.action).toBe('send_post_repo_notice');
    expect(next.dueAt?.toISOString()).toBe(addUtcDays(OPENED, 10).toISOString());
  });

  it('after the post-repo notice, the next gate is ready_for_disposition', () => {
    const next = computeNextRepoAction(
      makeRepoFacts(ST, {
        currentStep: 'post_repo_notice_sent',
        recoveredAt: OPENED.toISOString(),
        postRepoNoticeSentAt: OPENED.toISOString(),
      }),
      R,
      OPENED,
    );
    expect(next.action).toBe('ready_for_disposition');
  });

  it('holds personal property for 30 days', () => {
    const hold = computePersonalPropertyHold(OPENED, R);
    expect(hold.holdDays).toBe(30);
    expect(hold.holdUntil).toBe(addUtcDays(OPENED, 30).toISOString());
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
