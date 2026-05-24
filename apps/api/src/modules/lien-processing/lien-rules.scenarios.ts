/**
 * Shared test-scenario builders for the lien rule-engine specs (Session 23).
 *
 * Not a *.spec file (so vitest doesn't collect it as a suite) — it only
 * exposes pure data builders the per-state specs import. Kept beside the
 * engine so the 10 per-state spec files stay DRY.
 */
import type { LienState } from '@ustowdispatch/shared';
import type { LienCaseFacts } from './lien-rules.logic';

/** A fixed UTC anchor so day math in the specs is deterministic. */
export const OPENED = new Date('2026-01-01T00:00:00.000Z');

/**
 * Build a LienCaseFacts for `state`, defaulting to a freshly opened case,
 * owner + lienholder found, mid value. Override any field per test.
 */
export function makeFacts(state: LienState, overrides: Partial<LienCaseFacts> = {}): LienCaseFacts {
  return {
    state,
    status: 'open',
    currentStep: 'opened',
    valueTier: 'mid',
    ownerFound: true,
    lienholderFound: true,
    openedAt: OPENED,
    dmvLookupCompletedAt: null,
    ownerNoticeSentAt: null,
    lienholderNoticeSentAt: null,
    publicationCompletedAt: null,
    ownerResponseAt: null,
    lienholderResponseAt: null,
    ...overrides,
  };
}
