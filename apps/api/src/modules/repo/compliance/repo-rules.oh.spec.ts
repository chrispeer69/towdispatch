/**
 * Repo rule-engine spec — OH (right-to-cure BEFORE repossession (1317.12)).
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

const R = REPO_STATE_RULES.OH;
const ST = 'OH' as const;

describe('repo rules — OH', () => {
  it('config matches the OH statute profile', () => {
    expect(R.postRepoNoticeDays).toBe(10);
    expect(R.redemptionPeriodDays).toBe(0);
    expect(R.cureRightDays).toBe(10);
    expect(R.personalPropertyHoldDays).toBe(30);
    expect(R.preRepoNoticeRequired).toBe(true);
    expect(R.sheriffNoticeRequired).toBe(false);
    expect(R.secondaryContactRequired).toBe(false);
  });

  it('opens by send_pre_repo_notice', () => {
    const next = computeNextRepoAction(makeRepoFacts(ST), R, OPENED);
    expect(next.action).toBe('send_pre_repo_notice');
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

  it('requires a pre-repo notice + 10-day cure before recovery', () => {
    const sent = makeRepoFacts(ST, {
      currentStep: 'pre_repo_notice_sent',
      preRepoNoticeSentAt: OPENED.toISOString(),
    });
    const cureEnds = addUtcDays(OPENED, 10);
    expect(computeNextRepoAction(sent, R, addUtcDays(cureEnds, -1)).action).toBe(
      'await_pre_repo_cure_period',
    );
    expect(computeNextRepoAction(sent, R, cureEnds).action).toBe('record_recovery');
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
