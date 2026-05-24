/**
 * Breach-of-peace validator boundary spec (Repo Compliance, Session 50).
 *
 * Exercises validatePeacefulRepo against each UCC §9-609 breach condition in
 * isolation and in combination, plus the two per-state escalation flags
 * (presenceObjectionStrict, nightRepoIsBreach).
 */
import type { RepoStateRules } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { validatePeacefulRepo } from './repo-rules.logic';
import { makeAttempt } from './repo-rules.scenarios';
import { REPO_STATE_RULES } from './state-rules.config';

const CA = REPO_STATE_RULES.CA;

describe('validatePeacefulRepo — boundary cases', () => {
  it('a clean attempt (debtor absent, public street, no force) is allowed', () => {
    const res = validatePeacefulRepo(makeAttempt('CA'), CA);
    expect(res.allowed).toBe(true);
    expect(res.violations).toHaveLength(0);
    expect(res.statuteCitation).toBe(CA.statute);
  });

  it('debtor merely present (no objection) is still allowed', () => {
    const res = validatePeacefulRepo(makeAttempt('CA', { debtorPresent: true }), CA);
    expect(res.allowed).toBe(true);
  });

  for (const cond of [
    'usedOrThreatenedForce',
    'enteredResidence',
    'breachedLockedEnclosure',
    'lawEnforcementDirected',
  ] as const) {
    it(`flags ${cond} as a breach of the peace`, () => {
      const res = validatePeacefulRepo(makeAttempt('CA', { [cond]: true }), CA);
      expect(res.allowed).toBe(false);
      expect(res.violations).toHaveLength(1);
    });
  }

  it('flags a debtor objection when presenceObjectionStrict is true (the default)', () => {
    const res = validatePeacefulRepo(makeAttempt('CA', { debtorObjected: true }), CA);
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toContain('objected');
  });

  it('does NOT flag a debtor objection when presenceObjectionStrict is false', () => {
    const lenient: RepoStateRules = { ...CA, presenceObjectionStrict: false };
    const res = validatePeacefulRepo(makeAttempt('CA', { debtorObjected: true }), lenient);
    expect(res.allowed).toBe(true);
  });

  it('does NOT flag a nighttime repo by default (nightRepoIsBreach false for the top 10)', () => {
    expect(CA.nightRepoIsBreach).toBe(false);
    expect(validatePeacefulRepo(makeAttempt('CA', { occurredAtNight: true }), CA).allowed).toBe(
      true,
    );
  });

  it('flags a nighttime repo when the state escalates it', () => {
    const strict: RepoStateRules = { ...CA, nightRepoIsBreach: true };
    expect(validatePeacefulRepo(makeAttempt('CA', { occurredAtNight: true }), strict).allowed).toBe(
      false,
    );
  });

  it('accumulates multiple violations', () => {
    const res = validatePeacefulRepo(
      makeAttempt('CA', {
        usedOrThreatenedForce: true,
        enteredResidence: true,
        debtorObjected: true,
      }),
      CA,
    );
    expect(res.allowed).toBe(false);
    expect(res.violations.length).toBe(3);
  });
});
