/**
 * Unit spec — the six AI Smart Dispatch scoring factors (PURE).
 * Edge cases per factor: missing data → neutral, hard fails, boundaries.
 */
import { describe, expect, it } from 'vitest';
import {
  capabilityScore,
  certMatchScore,
  distanceScore,
  fatigueScore,
  historicalPerformanceScore,
  utilizationBalanceScore,
} from './factors';

describe('distanceScore', () => {
  it('co-located truck and pickup → 100', () => {
    const r = distanceScore({ truckLat: 40, truckLng: -75, pickupLat: 40, pickupLng: -75 });
    expect(r.score).toBe(100);
  });

  it('unknown truck position → neutral 50', () => {
    const r = distanceScore({ truckLat: null, truckLng: null, pickupLat: 40, pickupLng: -75 });
    expect(r.score).toBe(50);
    expect(r.detail).toMatch(/unknown/i);
  });

  it('unknown pickup position → neutral 50', () => {
    const r = distanceScore({ truckLat: 40, truckLng: -75, pickupLat: null, pickupLng: null });
    expect(r.score).toBe(50);
  });

  it('decays with distance and floors at 0 for a far truck', () => {
    // ~1 degree of latitude ≈ 69 miles → well past the 40-mi zero point.
    const r = distanceScore({ truckLat: 40, truckLng: -75, pickupLat: 41, pickupLng: -75 });
    expect(r.score).toBe(0);
  });

  it('a nearby truck outscores a distant one', () => {
    const near = distanceScore({ truckLat: 40.0, truckLng: -75, pickupLat: 40.05, pickupLng: -75 });
    const far = distanceScore({ truckLat: 40.0, truckLng: -75, pickupLat: 40.3, pickupLng: -75 });
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe('capabilityScore', () => {
  const base = {
    serviceType: 'tow',
    requiresHeavyDuty: false,
    isEv: false,
    truckEquipment: ['flatbed'] as string[],
    heavyDutyCapable: false,
  };

  it('flatbed truck for a tow → 100', () => {
    expect(capabilityScore(base).score).toBe(100);
  });

  it('heavy-duty job + non-HD truck → hard 0', () => {
    const r = capabilityScore({ ...base, requiresHeavyDuty: true, heavyDutyCapable: false });
    expect(r.score).toBe(0);
    expect(r.detail).toMatch(/HD-capable/i);
  });

  it('heavy-duty job + HD truck → not penalised', () => {
    const r = capabilityScore({
      ...base,
      serviceType: 'recovery',
      truckEquipment: ['wrecker_heavy'],
      requiresHeavyDuty: true,
      heavyDutyCapable: true,
    });
    expect(r.score).toBe(100);
  });

  it('tow with no matching equipment → -50', () => {
    const r = capabilityScore({ ...base, truckEquipment: ['jump_pack'] });
    expect(r.score).toBe(50);
  });

  it('EV without a flatbed → -30', () => {
    const r = capabilityScore({ ...base, isEv: true, truckEquipment: ['wheel_lift'] });
    // tow with wheel_lift is fine (-0) but EV without flatbed costs 30.
    expect(r.score).toBe(70);
  });
});

describe('certMatchScore', () => {
  const base = {
    serviceType: 'tow',
    requiresHeavyDuty: false,
    isEv: false,
    driverCerts: [] as string[],
    hdCertTypes: [] as string[],
    cdlClass: 'A',
  };

  it('plain tow, no special certs needed → 100', () => {
    expect(certMatchScore(base).score).toBe(100);
  });

  it('HD job, driver missing HD operator cert + no CDL A/B → -70', () => {
    const r = certMatchScore({ ...base, requiresHeavyDuty: true, cdlClass: 'none' });
    expect(r.score).toBe(30);
  });

  it('HD job, driver has HD operator + CDL A → 100', () => {
    const r = certMatchScore({
      ...base,
      requiresHeavyDuty: true,
      hdCertTypes: ['hd_operator'],
      cdlClass: 'A',
    });
    expect(r.score).toBe(100);
  });

  it('EV job, driver lacks Tesla cert → -30', () => {
    expect(certMatchScore({ ...base, isEv: true }).score).toBe(70);
  });

  it('EV job, driver has Tesla cert → 100', () => {
    expect(certMatchScore({ ...base, isEv: true, driverCerts: ['Tesla_certified'] }).score).toBe(
      100,
    );
  });

  it('recovery, driver lacks WreckMaster → -20', () => {
    expect(certMatchScore({ ...base, serviceType: 'recovery' }).score).toBe(80);
  });
});

describe('fatigueScore', () => {
  it('0 hours → fully fresh 100', () => {
    expect(fatigueScore(0).score).toBe(100);
  });

  it('8 hours (fresh boundary) → 100', () => {
    expect(fatigueScore(8).score).toBe(100);
  });

  it('11 hours → midpoint ~50', () => {
    expect(fatigueScore(11).score).toBe(50);
  });

  it('14 hours (HOS ceiling) → 0', () => {
    expect(fatigueScore(14).score).toBe(0);
  });

  it('16 hours (past HOS) → clamped 0', () => {
    expect(fatigueScore(16).score).toBe(0);
  });

  it('negative input is treated as 0 → 100', () => {
    expect(fatigueScore(-3).score).toBe(100);
  });
});

describe('historicalPerformanceScore', () => {
  it('no history → neutral 50', () => {
    const r = historicalPerformanceScore(null);
    expect(r.score).toBe(50);
    expect(r.detail).toMatch(/no recent/i);
  });

  it('perfect 0-min error → 100', () => {
    expect(historicalPerformanceScore(0).score).toBe(100);
  });

  it('10-min avg error → 60', () => {
    expect(historicalPerformanceScore(10).score).toBe(60);
  });

  it('25-min avg error → floors at 0', () => {
    expect(historicalPerformanceScore(25).score).toBe(0);
  });
});

describe('utilizationBalanceScore', () => {
  it('no completions yet this week → neutral 50', () => {
    expect(utilizationBalanceScore(0, 0).score).toBe(50);
  });

  it('driver well below the average → high score', () => {
    expect(utilizationBalanceScore(0, 5).score).toBe(100);
  });

  it('driver exactly at the average → 50', () => {
    expect(utilizationBalanceScore(5, 5).score).toBe(50);
  });

  it('driver at 2× the average → floors at 0', () => {
    expect(utilizationBalanceScore(10, 5).score).toBe(0);
  });
});
