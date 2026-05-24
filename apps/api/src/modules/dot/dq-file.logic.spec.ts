import { describe, expect, it } from 'vitest';
import {
  DQ_EXPIRY_WARNING_DAYS,
  type DqDriverFacts,
  type DqExtensionFacts,
  dqFileStatus,
} from './dq-file.logic.js';

const TODAY = new Date('2026-05-24T00:00:00.000Z');
const plusDays = (n: number): string => {
  const d = new Date(TODAY.getTime() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const fullDriver = (): DqDriverFacts => ({
  cdlClass: 'a',
  licenseNumber: 'D1234567',
  licenseExpiresAt: plusDays(365),
  medicalCardExpiresAt: plusDays(365),
  drugTestLastAt: plusDays(-30),
  roadTestCompletedAt: plusDays(-200),
});
const fullExt = (): DqExtensionFacts => ({
  employmentAppSignedAt: `${plusDays(-400)}T00:00:00.000Z`,
  mvrPulledAt: `${plusDays(-30)}T00:00:00.000Z`,
  mvrExpiresAt: `${plusDays(335)}T00:00:00.000Z`,
});

describe('dqFileStatus', () => {
  it('marks a fully-stocked file complete', () => {
    const r = dqFileStatus(fullDriver(), fullExt(), TODAY);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.expiring).toEqual([]);
  });

  it('lists every missing item when the extension is absent and dates are blank', () => {
    const driver: DqDriverFacts = {
      cdlClass: 'none',
      licenseNumber: null,
      licenseExpiresAt: null,
      medicalCardExpiresAt: null,
      drugTestLastAt: null,
      roadTestCompletedAt: null,
    };
    const r = dqFileStatus(driver, null, TODAY);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'employment_application',
        'drivers_license',
        'license_expiry',
        'medical_certificate',
        'mvr',
        'drug_test',
        'road_test',
      ]),
    );
  });

  it('treats an expired license/medical card as missing, not expiring', () => {
    const driver = {
      ...fullDriver(),
      licenseExpiresAt: plusDays(-1),
      medicalCardExpiresAt: plusDays(-1),
    };
    const r = dqFileStatus(driver, fullExt(), TODAY);
    expect(r.missing).toEqual(expect.arrayContaining(['license_expiry', 'medical_certificate']));
    expect(r.expiring.map((e) => e.item)).not.toContain('license_expiry');
  });

  it('flags an item expiring within the 60-day horizon with daysLeft', () => {
    const driver = { ...fullDriver(), medicalCardExpiresAt: plusDays(30) };
    const r = dqFileStatus(driver, fullExt(), TODAY);
    const med = r.expiring.find((e) => e.item === 'medical_certificate');
    expect(med?.daysLeft).toBe(30);
    expect(r.missing).not.toContain('medical_certificate');
  });

  it('includes the exact 60-day boundary as expiring but not 61 days', () => {
    const at60 = dqFileStatus(
      { ...fullDriver(), licenseExpiresAt: plusDays(DQ_EXPIRY_WARNING_DAYS) },
      fullExt(),
      TODAY,
    );
    expect(at60.expiring.some((e) => e.item === 'license_expiry')).toBe(true);

    const at61 = dqFileStatus(
      { ...fullDriver(), licenseExpiresAt: plusDays(DQ_EXPIRY_WARNING_DAYS + 1) },
      fullExt(),
      TODAY,
    );
    expect(at61.expiring.some((e) => e.item === 'license_expiry')).toBe(false);
  });

  it('counts MVR as missing when never pulled and ignores its expiry', () => {
    const ext: DqExtensionFacts = {
      employmentAppSignedAt: `${plusDays(-400)}T00:00:00.000Z`,
      mvrPulledAt: null,
      mvrExpiresAt: `${plusDays(-5)}T00:00:00.000Z`,
    };
    const r = dqFileStatus(fullDriver(), ext, TODAY);
    expect(r.missing).toContain('mvr');
    // expired MVR date must not also surface as a separate missing/expiring entry
    expect(r.missing.filter((m) => m === 'mvr')).toHaveLength(1);
  });
});
