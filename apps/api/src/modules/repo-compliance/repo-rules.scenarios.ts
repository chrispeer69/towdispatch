/**
 * Shared test-scenario builders for the repo rule-engine specs (Session 51).
 *
 * Not a *.spec file (so vitest doesn't collect it as a suite) — it only
 * exposes pure data builders the parameterized + integration specs import.
 * Kept beside the engine so the spec files stay DRY.
 */
import type { RepoState } from '@ustowdispatch/shared';
import type { RepoCaseFacts } from './repo-rules.logic';

/** A fixed UTC anchor so day math in the specs is deterministic. */
export const OPENED = new Date('2026-01-01T00:00:00.000Z');

/**
 * Build a RepoCaseFacts for `state`, defaulting to a freshly opened case at
 * mid value with nothing yet done. Override any field per test.
 */
export function makeFacts(state: RepoState, overrides: Partial<RepoCaseFacts> = {}): RepoCaseFacts {
  return {
    state,
    status: 'open',
    currentStep: 'opened',
    valueTier: 'mid',
    openedAt: OPENED,
    defaultNoticeSentAt: null,
    repossessedAt: null,
    personalPropertySecuredAt: null,
    postRepoNoticeSentAt: null,
    debtorResponseAt: null,
    ...overrides,
  };
}
