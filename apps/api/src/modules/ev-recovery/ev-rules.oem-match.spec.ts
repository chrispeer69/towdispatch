/**
 * OEM procedure matching spec — matchOemProcedure.
 *
 * Model match (within year range) beats make-wide fallback; year range is
 * inclusive with null = open-ended; most-recent applicable range wins.
 */
import { describe, expect, it } from 'vitest';
import { type OemMatchCandidate, matchOemProcedure } from './ev-rules.logic';

interface Row extends OemMatchCandidate {
  id: string;
}

const rows: Row[] = [
  { id: 'tesla-3', make: 'Tesla', model: 'Model 3', modelYearFrom: 2017, modelYearTo: null },
  { id: 'tesla-s-early', make: 'Tesla', model: 'Model S', modelYearFrom: 2012, modelYearTo: 2020 },
  { id: 'tesla-s-late', make: 'Tesla', model: 'Model S', modelYearFrom: 2021, modelYearTo: null },
  { id: 'tesla-any', make: 'Tesla', model: null, modelYearFrom: null, modelYearTo: null },
  {
    id: 'ford-lightning',
    make: 'Ford',
    model: 'F-150 Lightning',
    modelYearFrom: 2022,
    modelYearTo: null,
  },
];

describe('matchOemProcedure', () => {
  it('matches an exact model within its open-ended range', () => {
    expect(matchOemProcedure(rows, 'Tesla', 'Model 3', 2023)?.id).toBe('tesla-3');
  });

  it('is case-insensitive on make and model', () => {
    expect(matchOemProcedure(rows, 'tesla', 'model 3', 2020)?.id).toBe('tesla-3');
  });

  it('picks the correct year range when two ranges exist for one model', () => {
    expect(matchOemProcedure(rows, 'Tesla', 'Model S', 2015)?.id).toBe('tesla-s-early');
    expect(matchOemProcedure(rows, 'Tesla', 'Model S', 2022)?.id).toBe('tesla-s-late');
  });

  it('falls back to the make-wide row when the model year is out of range', () => {
    // Model 3 starts 2017; a 2015 lookup misses it and falls back to tesla-any.
    expect(matchOemProcedure(rows, 'Tesla', 'Model 3', 2015)?.id).toBe('tesla-any');
  });

  it('falls back to the make-wide row for an unknown model', () => {
    expect(matchOemProcedure(rows, 'Tesla', 'Roadster', 2020)?.id).toBe('tesla-any');
  });

  it('returns the make-wide row when no model is supplied', () => {
    expect(matchOemProcedure(rows, 'Tesla')?.id).toBe('tesla-any');
  });

  it('returns null when the make is unknown', () => {
    expect(matchOemProcedure(rows, 'Lucid', 'Air', 2023)).toBeNull();
  });

  it('returns null when a make has no model match and no make-wide fallback', () => {
    // Ford has only a specific model row, no make-wide fallback.
    expect(matchOemProcedure(rows, 'Ford', 'Mach-E', 2023)).toBeNull();
  });

  it('honors a closed year range upper bound', () => {
    expect(matchOemProcedure(rows, 'Ford', 'F-150 Lightning', 2021)?.id).toBeUndefined();
    expect(matchOemProcedure(rows, 'Ford', 'F-150 Lightning', 2022)?.id).toBe('ford-lightning');
  });
});
