import { describe, expect, it } from 'vitest';
import {
  type LookupCandidate,
  candidateMatches,
  classifyMatches,
  maskTail,
  normalizeLookupQuery,
  runLookup,
} from './lookup-matching.js';

const car = (over: Partial<LookupCandidate>): LookupCandidate => ({
  impoundId: '00000000-0000-0000-0000-000000000001',
  caseNumber: 'IMP-2026-0042',
  licensePlate: 'ABC-1234',
  vehicleVin: '1HGCM82633A004352',
  ownerLastName: 'Garcia',
  ...over,
});

describe('normalizeLookupQuery', () => {
  it('canonicalizes plate (upper, strips spaces/dashes) and lowercases lastName', () => {
    expect(normalizeLookupQuery({ plate: ' abc-1234 ', lastName: 'Garcia' })).toEqual({
      plate: 'ABC1234',
      lastName: 'garcia',
    });
  });
  it('omits blank fields', () => {
    expect(normalizeLookupQuery({ plate: '   ', vin: 'abc1' })).toEqual({ vin: 'ABC1' });
  });
});

describe('candidateMatches', () => {
  it('matches plate ignoring case and separators', () => {
    expect(candidateMatches(car({}), normalizeLookupQuery({ plate: 'abc1234' }))).toBe(true);
  });
  it('matches VIN by suffix (owner typed only the last 8)', () => {
    expect(candidateMatches(car({}), normalizeLookupQuery({ vin: '3A004352' }))).toBe(true);
  });
  it('AND-combines fields — a wrong lastName fails an otherwise-matching plate', () => {
    expect(
      candidateMatches(car({}), normalizeLookupQuery({ plate: 'abc1234', lastName: 'Smith' })),
    ).toBe(false);
  });
  it('never matches an empty query', () => {
    expect(candidateMatches(car({}), {})).toBe(false);
  });
  it('does not match a null plate', () => {
    expect(
      candidateMatches(car({ licensePlate: null }), normalizeLookupQuery({ plate: 'abc1234' })),
    ).toBe(false);
  });
});

describe('maskTail', () => {
  it('shows only the last 4', () => {
    expect(maskTail('ABC-1234')).toBe('***1234');
    expect(maskTail('1HGCM82633A004352')).toBe('***4352');
  });
  it('returns null for null', () => {
    expect(maskTail(null)).toBeNull();
  });
});

describe('classifyMatches', () => {
  it('none', () => {
    expect(classifyMatches([]).kind).toBe('none');
  });
  it('single returns the row, no masked previews', () => {
    const r = classifyMatches([car({})]);
    expect(r.kind).toBe('single');
    expect(r.single?.impoundId).toBe('00000000-0000-0000-0000-000000000001');
    expect(r.masked).toEqual([]);
  });
  it('multi returns masked previews only (never full data)', () => {
    const r = classifyMatches([
      car({ impoundId: 'a', caseNumber: 'IMP-1', licensePlate: 'AAA-1111' }),
      car({ impoundId: 'b', caseNumber: 'IMP-2', licensePlate: 'BBB-2222' }),
    ]);
    expect(r.kind).toBe('multi');
    expect(r.masked).toHaveLength(2);
    expect(r.masked[0]?.maskedPlate).toBe('***1111');
    // The full plate must never appear in a masked preview.
    expect(JSON.stringify(r.masked)).not.toContain('AAA-1111');
  });
});

describe('runLookup (filter + classify)', () => {
  const fleet = [
    car({ impoundId: 'a', caseNumber: 'IMP-A', licensePlate: 'AAA-1111', ownerLastName: 'Garcia' }),
    car({ impoundId: 'b', caseNumber: 'IMP-B', licensePlate: 'BBB-2222', ownerLastName: 'Garcia' }),
    car({ impoundId: 'c', caseNumber: 'IMP-C', licensePlate: 'CCC-3333', ownerLastName: 'Smith' }),
  ];
  it('unique plate → single', () => {
    expect(runLookup(fleet, { plate: 'bbb2222' }).kind).toBe('single');
  });
  it('shared lastName → multi', () => {
    expect(runLookup(fleet, { lastName: 'Garcia' }).kind).toBe('multi');
  });
  it('unknown → none', () => {
    expect(runLookup(fleet, { plate: 'ZZZ9999' }).kind).toBe('none');
  });
});
