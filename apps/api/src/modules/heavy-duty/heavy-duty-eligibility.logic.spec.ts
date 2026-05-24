/**
 * Unit tests for the pure HD eligibility logic. No DB / Nest.
 */
import { describe, expect, it } from 'vitest';
import {
  type DriverFacts,
  type HdJobRequirements,
  type TruckFacts,
  cdlRequiredForJob,
  certStatus,
  effectiveJobClass,
  eligibleDriversForHdJob,
  eligibleTrucksForHdJob,
  gvwrLbsToClass,
} from './heavy-duty-eligibility.logic.js';

const TODAY = '2026-05-24';

function job(overrides: Partial<HdJobRequirements> = {}): HdJobRequirements {
  return {
    vehicleClass: null,
    vehicleGvwrLbs: null,
    requiresRotator: false,
    requiresHazmat: false,
    ...overrides,
  };
}

function truck(overrides: Partial<TruckFacts> = {}): TruckFacts {
  return {
    truckId: '00000000-0000-0000-0000-000000000001',
    unitNumber: 'T-1',
    status: 'active',
    heavyDutyCapable: true,
    hasCapabilities: true,
    gvwrClass: 8,
    hasRotator: true,
    maxRecoveryWeightLbs: 80_000,
    ...overrides,
  };
}

function driver(certs: DriverFacts['certs'], overrides: Partial<DriverFacts> = {}): DriverFacts {
  return {
    driverId: '00000000-0000-0000-0000-0000000000a1',
    name: 'Sam Hauler',
    active: true,
    certs,
    ...overrides,
  };
}

describe('gvwrLbsToClass', () => {
  it('maps FMCSA brackets, class 8 open-ended', () => {
    expect(gvwrLbsToClass(6_000)).toBe(1);
    expect(gvwrLbsToClass(10_000)).toBe(2);
    expect(gvwrLbsToClass(14_000)).toBe(3);
    expect(gvwrLbsToClass(26_000)).toBe(6);
    expect(gvwrLbsToClass(26_001)).toBe(7);
    expect(gvwrLbsToClass(33_000)).toBe(7);
    expect(gvwrLbsToClass(33_001)).toBe(8);
    expect(gvwrLbsToClass(120_000)).toBe(8);
  });
});

describe('effectiveJobClass + cdlRequiredForJob', () => {
  it('prefers explicit class, else derives from gvwr, else null', () => {
    expect(effectiveJobClass(job({ vehicleClass: 7 }))).toBe(7);
    expect(effectiveJobClass(job({ vehicleGvwrLbs: 40_000 }))).toBe(8);
    expect(effectiveJobClass(job())).toBeNull();
  });
  it('requires CDL for class 7+ or hazmat', () => {
    expect(cdlRequiredForJob(job({ vehicleClass: 7 }))).toBe(true);
    expect(cdlRequiredForJob(job({ vehicleClass: 6 }))).toBe(false);
    expect(cdlRequiredForJob(job({ vehicleClass: 5, requiresHazmat: true }))).toBe(true);
    expect(cdlRequiredForJob(job())).toBe(false);
  });
});

describe('eligibleTrucksForHdJob', () => {
  it('passes a fully-capable truck for a class-8 rotator job', () => {
    const [r] = eligibleTrucksForHdJob(job({ vehicleClass: 8, requiresRotator: true }), [truck()]);
    expect(r?.eligible).toBe(true);
    expect(r?.reasons).toEqual([]);
  });

  it('blocks when the truck class is below the required class', () => {
    const [r] = eligibleTrucksForHdJob(job({ vehicleClass: 8 }), [truck({ gvwrClass: 6 })]);
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/below required class 8/);
  });

  it('blocks a rotator job when the truck has no rotator', () => {
    const [r] = eligibleTrucksForHdJob(job({ requiresRotator: true }), [
      truck({ hasRotator: false }),
    ]);
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/rotator/i);
  });

  it('blocks when vehicle weight exceeds the rated recovery weight', () => {
    const [r] = eligibleTrucksForHdJob(job({ vehicleGvwrLbs: 90_000 }), [
      truck({ maxRecoveryWeightLbs: 80_000 }),
    ]);
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/exceeds/);
  });

  it('blocks an out-of-service truck and one with no capability profile', () => {
    const [r] = eligibleTrucksForHdJob(job(), [
      truck({ status: 'out_of_service', hasCapabilities: false, gvwrClass: null }),
    ]);
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/not active/);
    expect(r?.reasons.join(' ')).toMatch(/No HD capability profile/);
  });

  it('flags unknown truck class when the job needs a known class', () => {
    const [r] = eligibleTrucksForHdJob(job({ vehicleClass: 7 }), [truck({ gvwrClass: null })]);
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/class unknown/);
  });

  it('sorts eligible trucks first', () => {
    const res = eligibleTrucksForHdJob(job({ vehicleClass: 8 }), [
      truck({ truckId: 'a', unitNumber: 'T-9', gvwrClass: 6 }), // ineligible
      truck({ truckId: 'b', unitNumber: 'T-2', gvwrClass: 8 }), // eligible
    ]);
    expect(res[0]?.eligible).toBe(true);
    expect(res[0]?.unitNumber).toBe('T-2');
  });
});

describe('eligibleDriversForHdJob — cert expiry edges', () => {
  it('passes a driver with a live hd_operator cert (no expiry)', () => {
    const [r] = eligibleDriversForHdJob(
      job(),
      [driver([{ certType: 'hd_operator', expiresAt: null }])],
      TODAY,
    );
    expect(r?.eligible).toBe(true);
  });

  it('treats a cert expiring exactly today as still valid', () => {
    const [r] = eligibleDriversForHdJob(
      job(),
      [driver([{ certType: 'hd_operator', expiresAt: TODAY }])],
      TODAY,
    );
    expect(r?.eligible).toBe(true);
  });

  it('treats a cert that expired yesterday as expired', () => {
    const [r] = eligibleDriversForHdJob(
      job(),
      [driver([{ certType: 'hd_operator', expiresAt: '2026-05-23' }])],
      TODAY,
    );
    expect(r?.eligible).toBe(false);
    expect(r?.expiredCerts).toContain('hd_operator');
  });

  it('reports a missing required cert', () => {
    const [r] = eligibleDriversForHdJob(job(), [driver([])], TODAY);
    expect(r?.eligible).toBe(false);
    expect(r?.missingCerts).toContain('hd_operator');
  });

  it('requires rotator + hazmat certs when the job demands them', () => {
    const [r] = eligibleDriversForHdJob(
      job({ requiresRotator: true, requiresHazmat: true }),
      [driver([{ certType: 'hd_operator', expiresAt: null }])],
      TODAY,
    );
    expect(r?.eligible).toBe(false);
    expect(r?.missingCerts).toEqual(expect.arrayContaining(['rotator', 'hazmat']));
  });

  it('requires a valid CDL for a class-8 job (cdl_b satisfies)', () => {
    const noCdl = eligibleDriversForHdJob(
      job({ vehicleClass: 8 }),
      [driver([{ certType: 'hd_operator', expiresAt: null }])],
      TODAY,
    );
    expect(noCdl[0]?.eligible).toBe(false);
    expect(noCdl[0]?.reasons.join(' ')).toMatch(/CDL/);

    const withCdl = eligibleDriversForHdJob(
      job({ vehicleClass: 8 }),
      [
        driver([
          { certType: 'hd_operator', expiresAt: null },
          { certType: 'cdl_b', expiresAt: '2030-01-01' },
        ]),
      ],
      TODAY,
    );
    expect(withCdl[0]?.eligible).toBe(true);
  });

  it('flags an expired CDL distinctly from a missing one', () => {
    const [r] = eligibleDriversForHdJob(
      job({ vehicleClass: 8 }),
      [
        driver([
          { certType: 'hd_operator', expiresAt: null },
          { certType: 'cdl_a', expiresAt: '2020-01-01' },
        ]),
      ],
      TODAY,
    );
    expect(r?.eligible).toBe(false);
    expect(r?.expiredCerts).toContain('cdl_a');
    expect(r?.reasons.join(' ')).toMatch(/expired/);
  });

  it('blocks an inactive driver even with all certs', () => {
    const [r] = eligibleDriversForHdJob(
      job(),
      [driver([{ certType: 'hd_operator', expiresAt: null }], { active: false })],
      TODAY,
    );
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.join(' ')).toMatch(/not active/);
  });
});

describe('certStatus', () => {
  it('classifies valid / expiring / expired against a 30-day window', () => {
    expect(certStatus(null, TODAY).status).toBe('valid');
    expect(certStatus('2026-07-01', TODAY).status).toBe('valid'); // 38 days out
    expect(certStatus('2026-06-10', TODAY).status).toBe('expiring'); // 17 days out
    expect(certStatus('2026-05-24', TODAY).status).toBe('expiring'); // today, 0 days
    expect(certStatus('2026-05-01', TODAY).status).toBe('expired');
  });

  it('honors a custom window', () => {
    expect(certStatus('2026-07-10', TODAY, 60).status).toBe('expiring'); // 47 days
    expect(certStatus('2026-07-10', TODAY, 30).status).toBe('valid');
  });
});
