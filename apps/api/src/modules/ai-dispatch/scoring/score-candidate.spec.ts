/**
 * Unit spec — composite candidate scoring + weight normalisation.
 *
 * Includes the "synthetic 5-truck fleet → expected top-1" ranking check: the
 * ranking that drives recommendForJob is pure, so we exercise it here without a
 * database (the DB round-trip is covered by ai-dispatch-rls.spec.ts).
 */
import { DEFAULT_FACTOR_WEIGHTS, type DispatchWeights } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { type ScoreCandidateInput, normalizeWeights, scoreCandidate } from './score-candidate';

const ALL_KEYS = [
  'distance',
  'capability',
  'cert_match',
  'fatigue',
  'historical_performance',
  'utilization_balance',
] as const;

describe('normalizeWeights', () => {
  it('normalises default weights to sum to 1', () => {
    const n = normalizeWeights(DEFAULT_FACTOR_WEIGHTS);
    const sum = ALL_KEYS.reduce((a, k) => a + n[k], 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('all-zero weights → equal split', () => {
    const zero = Object.fromEntries(ALL_KEYS.map((k) => [k, 0])) as DispatchWeights;
    const n = normalizeWeights(zero);
    for (const k of ALL_KEYS) expect(n[k]).toBeCloseTo(1 / ALL_KEYS.length, 6);
  });

  it('negative weights are floored to 0', () => {
    const w = { ...DEFAULT_FACTOR_WEIGHTS, distance: -10 } as DispatchWeights;
    const n = normalizeWeights(w);
    expect(n.distance).toBe(0);
  });
});

/** A perfect candidate: co-located, capable, certified, fresh, accurate, idle. */
function perfectInput(overrides: Partial<ScoreCandidateInput> = {}): ScoreCandidateInput {
  return {
    weights: DEFAULT_FACTOR_WEIGHTS,
    distance: { truckLat: 40, truckLng: -75, pickupLat: 40, pickupLng: -75 },
    capability: {
      serviceType: 'tow',
      requiresHeavyDuty: false,
      isEv: false,
      truckEquipment: ['flatbed'],
      heavyDutyCapable: false,
    },
    cert: {
      serviceType: 'tow',
      requiresHeavyDuty: false,
      isEv: false,
      driverCerts: [],
      hdCertTypes: [],
      cdlClass: 'A',
    },
    fatigueHours: 0,
    historicalAvgAbsErrorMinutes: 0,
    utilization: { driverCompletedThisWeek: 0, tenantAvgCompletedThisWeek: 5 },
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('a perfect candidate scores 100 with all six factors present', () => {
    const r = scoreCandidate(perfectInput());
    expect(r.score).toBe(100);
    expect(r.factors).toHaveLength(6);
    expect(r.factors.map((f) => f.key).sort()).toEqual([...ALL_KEYS].sort());
  });

  it('factor weights sum to 1 and contributions sum to the composite', () => {
    const r = scoreCandidate(perfectInput());
    const wSum = r.factors.reduce((a, f) => a + f.weight, 0);
    expect(wSum).toBeCloseTo(1, 4);
    const contribSum = r.factors.reduce((a, f) => a + f.weightedContribution, 0);
    expect(contribSum).toBeCloseTo(r.score, 1);
  });

  it('synthetic 5-truck fleet → the closest fully-capable truck is top-1', () => {
    const pickup = { pickupLat: 40.0, pickupLng: -75.0 };
    // Five candidates; #2 is co-located and fully capable → must win.
    const fleet = [
      { id: 'A', lat: 40.3, certs: [], hours: 0 }, // far
      { id: 'B', lat: 40.0, certs: [], hours: 0 }, // co-located ← expected top-1
      { id: 'C', lat: 40.1, certs: [], hours: 12 }, // near but fatigued
      { id: 'D', lat: 40.05, certs: [], hours: 0 }, // close-ish
      { id: 'E', lat: 40.0, certs: [], hours: 13 }, // co-located but nearly past HOS
    ];
    const scored = fleet
      .map((c) => ({
        id: c.id,
        score: scoreCandidate(
          perfectInput({
            distance: { truckLat: c.lat, truckLng: -75.0, ...pickup },
            fatigueHours: c.hours,
          }),
        ).score,
      }))
      .sort((x, y) => y.score - x.score);
    expect(scored[0]?.id).toBe('B');
  });

  it('an HD job with a non-HD truck is pushed down the ranking', () => {
    const hd = scoreCandidate(
      perfectInput({
        capability: {
          serviceType: 'recovery',
          requiresHeavyDuty: true,
          isEv: false,
          truckEquipment: ['flatbed'],
          heavyDutyCapable: false,
        },
      }),
    );
    const ok = scoreCandidate(perfectInput());
    expect(hd.score).toBeLessThan(ok.score);
  });
});
