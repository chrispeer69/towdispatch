/**
 * Unit spec — HeuristicEtaProvider / predictEtaHeuristic (PURE).
 * Rush-hour, off-hours, weekend, missing-position, distance bands, and the
 * tenant historical-bias correction.
 */
import { describe, expect, it } from 'vitest';
import {
  HeuristicEtaProvider,
  bandMph,
  predictEtaHeuristic,
  trafficFactor,
} from './heuristic-provider';

// A weekday (Wed 2026-05-20) and a weekend (Sat 2026-05-23) anchor.
const weekdayAt = (hour: number): Date => new Date(2026, 4, 20, hour, 0, 0);
const weekendAt = (hour: number): Date => new Date(2026, 4, 23, hour, 0, 0);

describe('bandMph', () => {
  it('short urban hop uses the slow band', () => {
    expect(bandMph(3)).toBe(22);
  });
  it('suburban distance uses the mid band', () => {
    expect(bandMph(12)).toBe(34);
  });
  it('long run uses the highway band', () => {
    expect(bandMph(40)).toBe(50);
  });
});

describe('trafficFactor', () => {
  it('weekday morning rush is heavy', () => {
    expect(trafficFactor(8, 3)).toEqual({ bucket: 'morning_rush', multiplier: 1.4 });
  });
  it('weekday evening rush is heaviest', () => {
    expect(trafficFactor(17, 3)).toEqual({ bucket: 'evening_rush', multiplier: 1.5 });
  });
  it('weekday midday is moderate', () => {
    expect(trafficFactor(12, 3).bucket).toBe('midday');
  });
  it('overnight is free-flowing (<1×)', () => {
    expect(trafficFactor(2, 3)).toEqual({ bucket: 'overnight', multiplier: 0.9 });
  });
  it('weekend never hits a commute peak', () => {
    expect(trafficFactor(8, 6).bucket).toBe('weekend');
    expect(trafficFactor(13, 0).bucket).toBe('weekend');
  });
});

describe('predictEtaHeuristic', () => {
  it('missing origin → null prediction', () => {
    const r = predictEtaHeuristic({
      originLat: null,
      originLng: null,
      destLat: 40,
      destLng: -75,
      departureTime: weekdayAt(12),
    });
    expect(r.predictedMinutes).toBeNull();
    expect(r.breakdown).toBeNull();
  });

  it('rush hour takes longer than off-peak for the same trip', () => {
    const trip = { originLat: 40.0, originLng: -75.0, destLat: 40.2, destLng: -75.0 };
    const rush = predictEtaHeuristic({ ...trip, departureTime: weekdayAt(17) });
    const overnight = predictEtaHeuristic({ ...trip, departureTime: weekdayAt(2) });
    expect(rush.predictedMinutes).toBeGreaterThan(overnight.predictedMinutes as number);
  });

  it('weekend midday is lighter than a weekday evening rush', () => {
    const trip = { originLat: 40.0, originLng: -75.0, destLat: 40.2, destLng: -75.0 };
    const weekend = predictEtaHeuristic({ ...trip, departureTime: weekendAt(13) });
    const weekdayRush = predictEtaHeuristic({ ...trip, departureTime: weekdayAt(17) });
    expect(weekend.predictedMinutes).toBeLessThan(weekdayRush.predictedMinutes as number);
  });

  it('records the inputs in the breakdown', () => {
    const r = predictEtaHeuristic({
      originLat: 40.0,
      originLng: -75.0,
      destLat: 40.2,
      destLng: -75.0,
      departureTime: weekdayAt(8),
    });
    expect(r.breakdown?.trafficBucket).toBe('morning_rush');
    expect(r.breakdown?.trafficMultiplier).toBe(1.4);
    expect(r.breakdown?.distanceMiles).toBeGreaterThan(0);
  });

  it('historical bias shifts the prediction by the signed minutes', () => {
    const trip = {
      originLat: 40.0,
      originLng: -75.0,
      destLat: 40.2,
      destLng: -75.0,
      departureTime: weekdayAt(12),
    };
    const base = predictEtaHeuristic(trip);
    const late = predictEtaHeuristic({ ...trip, historicalBiasMinutes: 5 });
    expect(late.predictedMinutes).toBe((base.predictedMinutes as number) + 5);
  });

  it('a large negative bias cannot push the ETA below zero', () => {
    const r = predictEtaHeuristic({
      originLat: 40.0,
      originLng: -75.0,
      destLat: 40.01,
      destLng: -75.0,
      departureTime: weekdayAt(12),
      historicalBiasMinutes: -999,
    });
    expect(r.predictedMinutes).toBe(0);
  });
});

describe('HeuristicEtaProvider', () => {
  it('exposes its id and model version', () => {
    const p = new HeuristicEtaProvider();
    expect(p.id).toBe('heuristic');
    expect(p.modelVersion).toBe('eta-heuristic-v1');
  });
});
