/**
 * Unit tests for the pure fraud-detection engine (Session 43). Each detector
 * is exercised with a positive, a negative, and an edge case; the composite
 * scorer is checked against the documented weights + band thresholds. No DB.
 */
import { describe, expect, it } from 'vitest';
import {
  type DetectedSignal,
  type JobFraudFacts,
  bandForScore,
  computeCompositeScore,
  detectBillToStorageAcceleration,
  detectCashOnlyPattern,
  detectDriverAnomaly,
  detectDuplicateInvoice,
  detectExcessiveMileage,
  detectGeofenceViolation,
  detectMissingEvidence,
  detectOffHoursDispatch,
  detectRapidResequencing,
  haversineMiles,
  runAllDetectors,
} from './fraud-signals.logic.js';

const DAY_MS = 86_400_000;
const T0 = new Date('2026-05-10T12:00:00.000Z');

/** A baseline facts object on which NO detector fires. */
function baseFacts(): JobFraudFacts {
  return {
    jobId: 'job-1',
    vin: null,
    motorClubName: null,
    jobCreatedAt: T0,
    siblingJobs: [],
    billedMiles: null,
    geocodedMiles: null,
    statusReversalCount: 0,
    dispatchHourLocal: 12,
    operatorOpenHour: 6,
    operatorCloseHour: 22,
    afterHoursFlag: false,
    invoiceTotalCents: null,
    evidencePhotoCount: 5,
    driverJobsOnDay: null,
    driver30dAvgPerDay: null,
    customerName: null,
    customerCashJobCount: 0,
    billedDropoff: null,
    actualDropoff: null,
    billedStorageDays: null,
    actualStorageDays: null,
  };
}

describe('baseline', () => {
  it('fires no signals on a clean job', () => {
    expect(runAllDetectors(baseFacts())).toEqual([]);
  });
});

describe('detectDuplicateInvoice', () => {
  it('fires high when a sibling is within the 2-day window', () => {
    const f: JobFraudFacts = {
      ...baseFacts(),
      vin: '1HGCM82633A004352',
      motorClubName: 'Agero',
      siblingJobs: [{ jobId: 'job-2', createdAt: new Date(T0.getTime() + DAY_MS) }],
    };
    const sig = detectDuplicateInvoice(f);
    expect(sig?.severity).toBe('high');
    expect(sig?.payload.duplicateJobId).toBe('job-2');
  });

  it('does not fire when the nearest sibling is outside the window', () => {
    const f: JobFraudFacts = {
      ...baseFacts(),
      vin: '1HGCM82633A004352',
      motorClubName: 'Agero',
      siblingJobs: [{ jobId: 'job-2', createdAt: new Date(T0.getTime() + 5 * DAY_MS) }],
    };
    expect(detectDuplicateInvoice(f)).toBeNull();
  });

  it('does not fire without a VIN (insufficient data)', () => {
    const f: JobFraudFacts = {
      ...baseFacts(),
      vin: null,
      motorClubName: 'Agero',
      siblingJobs: [{ jobId: 'job-2', createdAt: T0 }],
    };
    expect(detectDuplicateInvoice(f)).toBeNull();
  });
});

describe('detectExcessiveMileage', () => {
  it('fires high when billed miles are more than 2× the geocoded distance', () => {
    const sig = detectExcessiveMileage({ ...baseFacts(), billedMiles: 50, geocodedMiles: 10 });
    expect(sig?.severity).toBe('high');
    expect(sig?.payload.ratio).toBe(5);
  });

  it('does not fire just under the ratio threshold', () => {
    expect(
      detectExcessiveMileage({ ...baseFacts(), billedMiles: 11, geocodedMiles: 10 }),
    ).toBeNull();
  });

  it('does not fire exactly at the 1.3 threshold (boundary)', () => {
    expect(
      detectExcessiveMileage({ ...baseFacts(), billedMiles: 13, geocodedMiles: 10 }),
    ).toBeNull();
  });
});

describe('detectRapidResequencing', () => {
  it('fires medium at 4 reversals', () => {
    expect(detectRapidResequencing({ ...baseFacts(), statusReversalCount: 4 })?.severity).toBe(
      'medium',
    );
  });

  it('fires high above 5 reversals', () => {
    expect(detectRapidResequencing({ ...baseFacts(), statusReversalCount: 6 })?.severity).toBe(
      'high',
    );
  });

  it('does not fire at the threshold (3)', () => {
    expect(detectRapidResequencing({ ...baseFacts(), statusReversalCount: 3 })).toBeNull();
  });
});

describe('detectOffHoursDispatch', () => {
  it('fires when dispatched before opening', () => {
    expect(detectOffHoursDispatch({ ...baseFacts(), dispatchHourLocal: 3 })).not.toBeNull();
  });

  it('does not fire during business hours', () => {
    expect(detectOffHoursDispatch({ ...baseFacts(), dispatchHourLocal: 12 })).toBeNull();
  });

  it('does not fire when the after-hours flag is set', () => {
    expect(
      detectOffHoursDispatch({ ...baseFacts(), dispatchHourLocal: 3, afterHoursFlag: true }),
    ).toBeNull();
  });

  it('does not fire at the opening hour boundary', () => {
    expect(detectOffHoursDispatch({ ...baseFacts(), dispatchHourLocal: 6 })).toBeNull();
  });
});

describe('detectMissingEvidence', () => {
  it('fires when a high-value invoice has under 2 photos', () => {
    const sig = detectMissingEvidence({
      ...baseFacts(),
      invoiceTotalCents: 80_000,
      evidencePhotoCount: 1,
    });
    expect(sig?.severity).toBe('medium');
  });

  it('does not fire when enough photos exist', () => {
    expect(
      detectMissingEvidence({ ...baseFacts(), invoiceTotalCents: 80_000, evidencePhotoCount: 2 }),
    ).toBeNull();
  });

  it('does not fire below the value threshold', () => {
    expect(
      detectMissingEvidence({ ...baseFacts(), invoiceTotalCents: 40_000, evidencePhotoCount: 0 }),
    ).toBeNull();
  });
});

describe('detectDriverAnomaly', () => {
  it('fires high at 3× the baseline', () => {
    expect(
      detectDriverAnomaly({ ...baseFacts(), driverJobsOnDay: 9, driver30dAvgPerDay: 3 })?.severity,
    ).toBe('high');
  });

  it('fires at exactly 2× (boundary, inclusive)', () => {
    expect(
      detectDriverAnomaly({ ...baseFacts(), driverJobsOnDay: 6, driver30dAvgPerDay: 3 }),
    ).not.toBeNull();
  });

  it('does not fire below 2×', () => {
    expect(
      detectDriverAnomaly({ ...baseFacts(), driverJobsOnDay: 4, driver30dAvgPerDay: 3 }),
    ).toBeNull();
  });
});

describe('detectCashOnlyPattern', () => {
  it('fires medium at 5+ cash jobs', () => {
    expect(
      detectCashOnlyPattern({ ...baseFacts(), customerName: 'J. Doe', customerCashJobCount: 5 })
        ?.severity,
    ).toBe('medium');
  });

  it('fires low at the 3-job threshold', () => {
    expect(
      detectCashOnlyPattern({ ...baseFacts(), customerName: 'J. Doe', customerCashJobCount: 3 })
        ?.severity,
    ).toBe('low');
  });

  it('does not fire below the threshold', () => {
    expect(
      detectCashOnlyPattern({ ...baseFacts(), customerName: 'J. Doe', customerCashJobCount: 2 }),
    ).toBeNull();
  });
});

describe('detectGeofenceViolation', () => {
  it('fires when actual drop-off is well outside the geofence', () => {
    const sig = detectGeofenceViolation({
      ...baseFacts(),
      billedDropoff: { lat: 40.0, lng: -74.0 },
      actualDropoff: { lat: 40.2, lng: -74.0 }, // ~13.8 mi
    });
    expect(sig?.severity).toBe('high');
  });

  it('does not fire within the 5-mile radius', () => {
    expect(
      detectGeofenceViolation({
        ...baseFacts(),
        billedDropoff: { lat: 40.0, lng: -74.0 },
        actualDropoff: { lat: 40.05, lng: -74.0 }, // ~3.45 mi
      }),
    ).toBeNull();
  });

  it('does not fire without actual coordinates (no telemetry)', () => {
    expect(
      detectGeofenceViolation({
        ...baseFacts(),
        billedDropoff: { lat: 40.0, lng: -74.0 },
        actualDropoff: null,
      }),
    ).toBeNull();
  });
});

describe('detectBillToStorageAcceleration', () => {
  it('fires high when billed storage days far exceed the actual gap', () => {
    expect(
      detectBillToStorageAcceleration({
        ...baseFacts(),
        billedStorageDays: 10,
        actualStorageDays: 5,
      })?.severity,
    ).toBe('high');
  });

  it('fires medium for a small over-bill', () => {
    expect(
      detectBillToStorageAcceleration({
        ...baseFacts(),
        billedStorageDays: 6,
        actualStorageDays: 5,
      })?.severity,
    ).toBe('medium');
  });

  it('does not fire when billed matches actual', () => {
    expect(
      detectBillToStorageAcceleration({
        ...baseFacts(),
        billedStorageDays: 5,
        actualStorageDays: 5,
      }),
    ).toBeNull();
  });
});

describe('haversineMiles', () => {
  it('is ~13.8 miles for 0.2° of latitude', () => {
    const d = haversineMiles({ lat: 40.0, lng: -74.0 }, { lat: 40.2, lng: -74.0 });
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(15);
  });
});

describe('bandForScore', () => {
  it('maps scores to bands at the documented thresholds', () => {
    expect(bandForScore(0)).toBe('low');
    expect(bandForScore(29)).toBe('low');
    expect(bandForScore(30)).toBe('medium');
    expect(bandForScore(59)).toBe('medium');
    expect(bandForScore(60)).toBe('high');
    expect(bandForScore(79)).toBe('high');
    expect(bandForScore(80)).toBe('critical');
    expect(bandForScore(100)).toBe('critical');
  });
});

describe('computeCompositeScore', () => {
  it('scores an empty signal set as 0 / low', () => {
    const r = computeCompositeScore([]);
    expect(r.score).toBe(0);
    expect(r.band).toBe('low');
    expect(r.topSignals).toEqual([]);
  });

  it('weights a single high-confidence fraud signal into the medium band', () => {
    const sig: DetectedSignal = {
      signalType: 'duplicate_invoice', // weight 45
      severity: 'high', // ×1.0
      confidencePct: 90, // ×0.9 ⇒ ~40.5
      payload: {},
    };
    const r = computeCompositeScore([sig]);
    expect(r.score).toBe(41);
    expect(r.band).toBe('medium');
  });

  it('stacks two strong fraud signals into the critical band and caps topSignals at 5', () => {
    const signals: DetectedSignal[] = [
      { signalType: 'duplicate_invoice', severity: 'high', confidencePct: 95, payload: {} },
      { signalType: 'geofence_violation', severity: 'high', confidencePct: 95, payload: {} },
      { signalType: 'missing_evidence', severity: 'medium', confidencePct: 80, payload: {} },
      { signalType: 'off_hours_dispatch', severity: 'low', confidencePct: 60, payload: {} },
      { signalType: 'cash_only_pattern', severity: 'low', confidencePct: 50, payload: {} },
      { signalType: 'driver_anomaly', severity: 'medium', confidencePct: 50, payload: {} },
    ];
    const r = computeCompositeScore(signals);
    expect(r.score).toBe(100); // clamped
    expect(r.band).toBe('critical');
    expect(r.topSignals).toHaveLength(5);
    // Highest-weight signal sorts first.
    expect(r.topSignals[0]?.signalType).toBe('duplicate_invoice');
  });

  it('ignores info-severity signals (zero multiplier)', () => {
    const r = computeCompositeScore([
      { signalType: 'off_hours_dispatch', severity: 'info', confidencePct: 100, payload: {} },
    ]);
    expect(r.score).toBe(0);
  });
});
