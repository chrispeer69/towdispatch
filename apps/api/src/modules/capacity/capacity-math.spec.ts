/**
 * CADS pure-math unit coverage (gate 1): ratio math, weighting, band
 * mapping, hysteresis buffer + dwell, override precedence + expiry,
 * zero-driver OFFLINE, per-class separation.
 */
import { describe, expect, it } from 'vitest';
import {
  type HysteresisSettings,
  type HysteresisState,
  applyHysteresis,
  bandForRatio,
  blendClasses,
  computeClass,
  effectiveBand,
  isOverrideActive,
  loadRatio,
  weightedJobs,
} from './capacity-math.js';

const T: HysteresisSettings = {
  availableMaxRatio: 0.75,
  limitedMaxRatio: 1.5,
  constrainedMaxRatio: 2.0,
  hysteresisBuffer: 0.05,
  hysteresisDwellSeconds: 60,
};

describe('loadRatio', () => {
  it('divides weighted jobs by drivers', () => {
    expect(loadRatio(3, 4)).toBeCloseTo(0.75);
  });
  it('returns null (OFFLINE), never divides by zero', () => {
    expect(loadRatio(5, 0)).toBeNull();
    expect(loadRatio(0, 0)).toBeNull();
  });
});

describe('weightedJobs', () => {
  const weights = { dispatched: 1.0, enroute: 1.0, on_scene: 1.0, in_progress: 0.5 };
  it('sums weight × count per status', () => {
    expect(weightedJobs({ dispatched: 2, in_progress: 3 }, weights)).toBeCloseTo(3.5);
  });
  it('statuses absent from the weight map count zero', () => {
    expect(weightedJobs({ completed: 10, new: 4 }, weights)).toBe(0);
  });
  it('zero-weight statuses count zero', () => {
    expect(weightedJobs({ dispatched: 2 }, { dispatched: 0 })).toBe(0);
  });
});

describe('bandForRatio', () => {
  it('maps thresholds inclusively at each upper bound', () => {
    expect(bandForRatio(0, T)).toBe('available_now');
    expect(bandForRatio(0.75, T)).toBe('available_now');
    expect(bandForRatio(0.76, T)).toBe('limited');
    expect(bandForRatio(1.5, T)).toBe('limited');
    expect(bandForRatio(1.51, T)).toBe('constrained');
    expect(bandForRatio(2.0, T)).toBe('constrained');
    expect(bandForRatio(2.01, T)).toBe('at_capacity');
    expect(bandForRatio(50, T)).toBe('at_capacity');
  });
  it('null ratio is OFFLINE', () => {
    expect(bandForRatio(null, T)).toBe('offline');
  });
});

describe('computeClass — zero drivers', () => {
  it('is OFFLINE, not AT_CAPACITY, even with active jobs', () => {
    const c = computeClass({ dutyClass: 'heavy', eligibleDrivers: 0, weightedActiveJobs: 7 }, T);
    expect(c.band).toBe('offline');
    expect(c.ratio).toBeNull();
  });
});

describe('per-class separation + blending', () => {
  it('each class computes independently and the blend sums tallies', () => {
    const light = computeClass(
      { dutyClass: 'light', eligibleDrivers: 4, weightedActiveJobs: 2 },
      T,
    );
    const heavy = computeClass(
      { dutyClass: 'heavy', eligibleDrivers: 1, weightedActiveJobs: 3 },
      T,
    );
    expect(light.band).toBe('available_now'); // 0.5
    expect(heavy.band).toBe('at_capacity'); // 3.0
    const blended = blendClasses([light, heavy]);
    expect(blended.eligibleDrivers).toBe(5);
    expect(blended.weightedActiveJobs).toBe(5);
    expect(computeClass(blended, T).band).toBe('limited'); // 1.0
  });
});

describe('applyHysteresis', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const later = (s: number) => new Date(now.getTime() + s * 1000);
  const stable = (band: HysteresisState['band']): HysteresisState => ({
    band,
    pendingBand: null,
    pendingSince: null,
  });

  it('first observation publishes the raw band immediately', () => {
    const r = applyHysteresis(null, 0.5, 'available_now', T, now);
    expect(r.state.band).toBe('available_now');
    expect(r.transitioned).toBe(true);
  });

  it('same band holds and clears any pending', () => {
    const prev: HysteresisState = {
      band: 'limited',
      pendingBand: 'constrained',
      pendingSince: now.toISOString(),
    };
    const r = applyHysteresis(prev, 1.0, 'limited', T, later(10));
    expect(r.state).toEqual(stable('limited'));
    expect(r.transitioned).toBe(false);
  });

  it('crossing the boundary within the buffer does NOT flip immediately', () => {
    // 0.78 is past 0.75 but only by 0.03 < buffer 0.05 → pending, publish old.
    const r = applyHysteresis(stable('available_now'), 0.78, 'limited', T, now);
    expect(r.state.band).toBe('available_now');
    expect(r.state.pendingBand).toBe('limited');
    expect(r.transitioned).toBe(false);
  });

  it('crossing the boundary beyond the buffer flips immediately', () => {
    const r = applyHysteresis(stable('available_now'), 0.81, 'limited', T, now);
    expect(r.state.band).toBe('limited');
    expect(r.transitioned).toBe(true);
  });

  it('buffer applies symmetrically on the way down', () => {
    // 1.48 is under 1.50 by 0.02 < buffer → still constrained.
    const down = applyHysteresis(stable('constrained'), 1.48, 'limited', T, now);
    expect(down.state.band).toBe('constrained');
    // 1.40 is under by 0.10 > buffer → limited immediately.
    const decisive = applyHysteresis(stable('constrained'), 1.4, 'limited', T, now);
    expect(decisive.state.band).toBe('limited');
  });

  it('in-buffer change publishes after the dwell elapses', () => {
    const first = applyHysteresis(stable('available_now'), 0.78, 'limited', T, now);
    expect(first.state.band).toBe('available_now');
    // 30s later — still inside dwell.
    const mid = applyHysteresis(first.state, 0.78, 'limited', T, later(30));
    expect(mid.state.band).toBe('available_now');
    expect(mid.transitioned).toBe(false);
    // 60s later — dwell satisfied.
    const done = applyHysteresis(mid.state, 0.78, 'limited', T, later(60));
    expect(done.state.band).toBe('limited');
    expect(done.transitioned).toBe(true);
  });

  it('a different pending candidate resets the dwell clock', () => {
    // 1.52 from 'limited': past 1.50 by 0.02 < buffer → pending constrained.
    const first = applyHysteresis(stable('limited'), 1.52, 'constrained', T, now);
    expect(first.state.pendingBand).toBe('constrained');
    // Wobble to 0.73: under 0.75 by 0.02 < buffer (nudged 0.78 is still
    // 'limited') → new pending candidate, dwell clock restarts at 59s.
    const wobble = applyHysteresis(first.state, 0.73, 'available_now', T, later(59));
    expect(wobble.state.band).toBe('limited');
    expect(wobble.state.pendingBand).toBe('available_now');
    expect(wobble.state.pendingSince).toBe(later(59).toISOString());
  });

  it('a decisive multi-band jump flips immediately', () => {
    // 2.02 from 'limited' clears the constrained boundary by 0.52 » buffer.
    const r = applyHysteresis(stable('limited'), 2.02, 'at_capacity', T, now);
    expect(r.state.band).toBe('at_capacity');
    expect(r.transitioned).toBe(true);
  });

  it('OFFLINE transitions bypass hysteresis both ways', () => {
    const off = applyHysteresis(stable('limited'), null, 'offline', T, now);
    expect(off.state.band).toBe('offline');
    expect(off.transitioned).toBe(true);
    const back = applyHysteresis(off.state, 0.2, 'available_now', T, later(1));
    expect(back.state.band).toBe('available_now');
    expect(back.transitioned).toBe(true);
  });
});

describe('effectiveBand — override precedence', () => {
  it('computed band wins when no override', () => {
    expect(effectiveBand('light', 'limited', [])).toEqual({
      band: 'limited',
      overrideActive: false,
    });
  });
  it('global override forces every class', () => {
    const overrides = [{ dutyClass: 'all' as const, forcedBand: 'at_capacity' as const }];
    expect(effectiveBand('light', 'available_now', overrides).band).toBe('at_capacity');
    expect(effectiveBand('heavy', 'offline', overrides).band).toBe('at_capacity');
  });
  it('scoped override beats the global override', () => {
    const overrides = [
      { dutyClass: 'all' as const, forcedBand: 'at_capacity' as const },
      { dutyClass: 'heavy' as const, forcedBand: 'available_now' as const },
    ];
    expect(effectiveBand('heavy', 'limited', overrides).band).toBe('available_now');
    expect(effectiveBand('light', 'limited', overrides).band).toBe('at_capacity');
  });
});

describe('isOverrideActive — expiry', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const base = { clearedAt: null, deletedAt: null };
  it('active while uncleared and unexpired', () => {
    expect(isOverrideActive({ ...base, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(
      true,
    );
  });
  it('inactive at/after expiry (computed status resumes)', () => {
    expect(isOverrideActive({ ...base, expiresAt: now }, now)).toBe(false);
  });
  it('inactive once cleared', () => {
    expect(
      isOverrideActive(
        { clearedAt: now, deletedAt: null, expiresAt: new Date(now.getTime() + 1000) },
        now,
      ),
    ).toBe(false);
  });
});
