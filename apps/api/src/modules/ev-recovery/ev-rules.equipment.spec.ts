/**
 * EV equipment rule-engine spec — requiredEquipmentForEv.
 *
 * Conservative posture: flatbed unless a known model permits a confirmed
 * short wheels-down move and the pack isn't critically low.
 */
import { describe, expect, it } from 'vitest';
import { type EvEquipmentFacts, requiredEquipmentForEv } from './ev-rules.logic';

function facts(over: Partial<EvEquipmentFacts> = {}): EvEquipmentFacts {
  return {
    make: null,
    model: null,
    towModeEngaged: false,
    hvIsolated: false,
    stateOfChargePct: null,
    distanceMiles: null,
    thermalEventObserved: false,
    ...over,
  };
}

describe('requiredEquipmentForEv', () => {
  it('unknown EV → flatbed only, no dollies, no wheel-lift', () => {
    const r = requiredEquipmentForEv(facts());
    expect(r.flatbedRequired).toBe(true);
    expect(r.dolliesAllowed).toBe(false);
    expect(r.wheelLiftAllowed).toBe(false);
    expect(r.maxWheelDownMiles).toBe(0);
    expect(r.reasons.join(' ')).toMatch(/unknown ev/i);
  });

  it('Tesla → flatbed only regardless of distance', () => {
    const r = requiredEquipmentForEv(facts({ make: 'Tesla', model: 'Model 3', distanceMiles: 1 }));
    expect(r.flatbedRequired).toBe(true);
    expect(r.dolliesAllowed).toBe(false);
    expect(r.wheelLiftAllowed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/flatbed-only/i);
  });

  it('Tesla Model Y (AWD) → flatbed only even for a 2-mile move', () => {
    const r = requiredEquipmentForEv(facts({ make: 'Tesla', model: 'Model Y', distanceMiles: 2 }));
    expect(r.flatbedRequired).toBe(true);
    expect(r.dolliesAllowed).toBe(false);
  });

  it('Bolt within the short-move limit → wheel-lift + dollies allowed', () => {
    const r = requiredEquipmentForEv(
      facts({ make: 'Chevrolet', model: 'Bolt EV', distanceMiles: 3, stateOfChargePct: 40 }),
    );
    expect(r.flatbedRequired).toBe(false);
    expect(r.wheelLiftAllowed).toBe(true);
    expect(r.dolliesAllowed).toBe(true);
    expect(r.maxWheelDownMiles).toBe(5);
  });

  it('Bolt over the limit → flatbed required', () => {
    const r = requiredEquipmentForEv(
      facts({ make: 'Chevrolet', model: 'Bolt EV', distanceMiles: 40, stateOfChargePct: 40 }),
    );
    expect(r.flatbedRequired).toBe(true);
    expect(r.wheelLiftAllowed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/exceeds/i);
  });

  it('Bolt with unknown distance → flatbed required (cannot confirm short move)', () => {
    const r = requiredEquipmentForEv(
      facts({ make: 'Chevrolet', model: 'Bolt EV', distanceMiles: null, stateOfChargePct: 40 }),
    );
    expect(r.flatbedRequired).toBe(true);
    expect(r.wheelLiftAllowed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/distance unknown/i);
  });

  it('low SOC overrides a short-move allowance → flatbed only', () => {
    const r = requiredEquipmentForEv(
      facts({ make: 'Chevrolet', model: 'Bolt EV', distanceMiles: 2, stateOfChargePct: 2 }),
    );
    expect(r.flatbedRequired).toBe(true);
    expect(r.wheelLiftAllowed).toBe(false);
    expect(r.dolliesAllowed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/state of charge/i);
  });

  it('thermal event observed → HV isolation required', () => {
    const r = requiredEquipmentForEv(
      facts({ make: 'Tesla', model: 'Model 3', thermalEventObserved: true }),
    );
    expect(r.hvIsolationRequired).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/isolate the hv/i);
  });

  it('no thermal event → HV isolation not forced', () => {
    const r = requiredEquipmentForEv(facts({ make: 'Tesla', model: 'Model 3' }));
    expect(r.hvIsolationRequired).toBe(false);
  });
});
