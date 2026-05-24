import { describe, expect, it } from 'vitest';
import { type ComparableFinding, compareFindings, summarizeComparison } from './compare.logic.js';

function f(
  overrides: Partial<ComparableFinding> & Pick<ComparableFinding, 'area'>,
): ComparableFinding {
  return {
    severity: 'moderate',
    confidencePct: 90,
    ...overrides,
  };
}

describe('compareFindings — new damage detection', () => {
  it('flags damage in an area with no pre-tow finding as new', () => {
    const r = compareFindings([], [f({ area: 'front_bumper', severity: 'minor' })]);
    expect(r.newDamage).toHaveLength(1);
    expect(r.newDamage[0]?.area).toBe('front_bumper');
    expect(r.newDamage[0]?.priorSeverity).toBeNull();
    expect(r.preExisting).toHaveLength(0);
    expect(r.inconclusive).toHaveLength(0);
  });

  it('flags a severity escalation as new damage', () => {
    const r = compareFindings(
      [f({ area: 'hood', severity: 'minor' })],
      [f({ area: 'hood', severity: 'severe' })],
    );
    expect(r.newDamage).toHaveLength(1);
    expect(r.newDamage[0]?.priorSeverity).toBe('minor');
    expect(r.newDamage[0]?.severity).toBe('severe');
    expect(r.preExisting).toHaveLength(0);
  });

  it('treats a pre-tow finding of severity none as no baseline (post damage is new)', () => {
    const r = compareFindings(
      [f({ area: 'roof', severity: 'none' })],
      [f({ area: 'roof', severity: 'minor' })],
    );
    expect(r.newDamage).toHaveLength(1);
    expect(r.newDamage[0]?.priorSeverity).toBeNull();
  });
});

describe('compareFindings — pre-existing detection', () => {
  it('classifies equal-severity damage as pre-existing', () => {
    const r = compareFindings(
      [f({ area: 'driver_door', severity: 'moderate' })],
      [f({ area: 'driver_door', severity: 'moderate' })],
    );
    expect(r.preExisting).toHaveLength(1);
    expect(r.preExisting[0]?.priorSeverity).toBe('moderate');
    expect(r.newDamage).toHaveLength(0);
  });

  it('classifies a post-tow severity DECREASE as pre-existing (not new)', () => {
    const r = compareFindings(
      [f({ area: 'trunk', severity: 'severe' })],
      [f({ area: 'trunk', severity: 'minor' })],
    );
    expect(r.preExisting).toHaveLength(1);
    expect(r.newDamage).toHaveLength(0);
  });
});

describe('compareFindings — inconclusive cases', () => {
  it('classifies a pre-only area (lost finding) as inconclusive', () => {
    const r = compareFindings([f({ area: 'wheels', severity: 'moderate' })], []);
    expect(r.inconclusive).toHaveLength(1);
    expect(r.inconclusive[0]?.area).toBe('wheels');
    expect(r.inconclusive[0]?.reason).toMatch(/not re-detected/);
    expect(r.newDamage).toHaveLength(0);
    expect(r.preExisting).toHaveLength(0);
  });

  it('classifies a low-confidence post finding as inconclusive, not new', () => {
    const r = compareFindings(
      [],
      [f({ area: 'windshield', severity: 'severe', confidencePct: 40 })],
    );
    expect(r.inconclusive).toHaveLength(1);
    expect(r.newDamage).toHaveLength(0);
  });

  it('does not let a low-confidence pre finding establish a baseline', () => {
    // pre finding is low-confidence → ignored for baseline; confident post = new.
    const r = compareFindings(
      [f({ area: 'hood', severity: 'severe', confidencePct: 30 })],
      [f({ area: 'hood', severity: 'minor', confidencePct: 95 })],
    );
    expect(r.newDamage).toHaveLength(1);
    expect(r.newDamage[0]?.priorSeverity).toBeNull();
  });
});

describe('compareFindings — confidence threshold filtering', () => {
  it('treats confidencePct exactly at the threshold as confident (>=)', () => {
    // threshold 0.65 → 65% is confident.
    const r = compareFindings(
      [],
      [f({ area: 'front_bumper', severity: 'minor', confidencePct: 65 })],
    );
    expect(r.newDamage).toHaveLength(1);
  });

  it('treats one below the threshold as inconclusive', () => {
    const r = compareFindings(
      [],
      [f({ area: 'front_bumper', severity: 'minor', confidencePct: 64 })],
    );
    expect(r.inconclusive).toHaveLength(1);
    expect(r.newDamage).toHaveLength(0);
  });

  it('honours a custom threshold', () => {
    // threshold 0.9 → an 80% finding is inconclusive.
    const r = compareFindings([], [f({ area: 'roof', severity: 'severe', confidencePct: 80 })], {
      threshold: 0.9,
    });
    expect(r.inconclusive).toHaveLength(1);
  });
});

describe('compareFindings — operator overrides & dismissal', () => {
  it('ignores dismissed post findings', () => {
    const r = compareFindings([], [f({ area: 'hood', severity: 'severe', isDismissed: true })]);
    expect(r.newDamage).toHaveLength(0);
    expect(r.inconclusive).toHaveLength(0);
  });

  it('ignores dismissed pre findings for the baseline', () => {
    const r = compareFindings(
      [f({ area: 'hood', severity: 'severe', isDismissed: true })],
      [f({ area: 'hood', severity: 'minor' })],
    );
    expect(r.newDamage).toHaveLength(1); // pre baseline dismissed → post minor is new
  });

  it('uses operator severity override over the model severity', () => {
    // model says severe but operator downgraded to none → no longer damage.
    const r = compareFindings(
      [],
      [f({ area: 'roof', severity: 'severe', operatorSeverity: 'none' })],
    );
    expect(r.newDamage).toHaveLength(0);
  });

  it('operator escalation flips pre-existing into new damage', () => {
    const r = compareFindings(
      [f({ area: 'trunk', severity: 'minor' })],
      [f({ area: 'trunk', severity: 'minor', operatorSeverity: 'severe' })],
    );
    expect(r.newDamage).toHaveLength(1);
    expect(r.newDamage[0]?.severity).toBe('severe');
  });
});

describe('summarizeComparison', () => {
  it('renders counts and the threshold percent', () => {
    const r = compareFindings(
      [f({ area: 'hood', severity: 'minor' })],
      [
        f({ area: 'front_bumper', severity: 'severe' }), // new
        f({ area: 'hood', severity: 'minor' }), // pre-existing
      ],
    );
    expect(summarizeComparison(r, 0.65)).toBe(
      '1 new, 1 pre-existing, 0 inconclusive (confidence ≥ 65%)',
    );
  });
});
