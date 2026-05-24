/**
 * Shared fixtures for the repo rule-engine specs (Repo Compliance, Session 50).
 * OPENED is a fixed UTC instant so day math is deterministic. makeRepoFacts /
 * makeAttempt build a sensible default the per-state specs override.
 */
import type { RepoAttemptFacts, RepoCaseFacts, RepoState } from '@ustowdispatch/shared';

export const OPENED = new Date('2026-03-01T00:00:00.000Z');

export function makeRepoFacts(
  state: RepoState,
  overrides: Partial<RepoCaseFacts> = {},
): RepoCaseFacts {
  return {
    state,
    status: 'open',
    currentStep: 'opened',
    openedAt: OPENED.toISOString(),
    preRepoNoticeSentAt: null,
    recoveredAt: null,
    postRepoNoticeSentAt: null,
    sheriffNoticeSentAt: null,
    secondaryContactNotifiedAt: null,
    debtorResponseAt: null,
    breachOfPeaceFlagged: false,
    ...overrides,
  };
}

export function makeAttempt(
  state: RepoState,
  overrides: Partial<RepoAttemptFacts> = {},
): RepoAttemptFacts {
  return {
    state,
    debtorPresent: false,
    debtorObjected: false,
    breachedLockedEnclosure: false,
    enteredResidence: false,
    usedOrThreatenedForce: false,
    lawEnforcementDirected: false,
    occurredAtNight: false,
    ...overrides,
  };
}
