/**
 * Unit coverage for validateStallAssignment (Yard Management, Session 54).
 * Pure — no DB / Nest container.
 */
import { describe, expect, it } from 'vitest';
import { type StallAssignmentInput, validateStallAssignment } from './yard-stall.logic.js';

const base = (over: Partial<StallAssignmentInput> = {}): StallAssignmentInput => ({
  stall: { deletedAt: null, occupiedByImpoundId: null, stallType: 'standard' },
  impoundId: 'imp-1',
  vehicleClass: 'passenger',
  isElectric: false,
  ...over,
});

describe('validateStallAssignment', () => {
  it('allows a free standard stall for a passenger vehicle', () => {
    expect(validateStallAssignment(base())).toEqual({ allowed: true, reason: null });
  });

  it('rejects a soft-deleted stall', () => {
    const r = validateStallAssignment(
      base({ stall: { deletedAt: new Date(), occupiedByImpoundId: null, stallType: 'standard' } }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/removed/i);
  });

  it('rejects a stall occupied by a different vehicle', () => {
    const r = validateStallAssignment(
      base({ stall: { deletedAt: null, occupiedByImpoundId: 'imp-OTHER', stallType: 'standard' } }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/already occupied/i);
  });

  it('allows re-assigning a stall already holding the SAME vehicle (idempotent)', () => {
    const r = validateStallAssignment(
      base({ stall: { deletedAt: null, occupiedByImpoundId: 'imp-1', stallType: 'standard' } }),
    );
    expect(r.allowed).toBe(true);
  });

  it('rejects a non-EV in an EV stall', () => {
    const r = validateStallAssignment(
      base({
        stall: { deletedAt: null, occupiedByImpoundId: null, stallType: 'ev' },
        isElectric: false,
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/EV stall/i);
  });

  it('allows an EV in an EV stall', () => {
    const r = validateStallAssignment(
      base({
        stall: { deletedAt: null, occupiedByImpoundId: null, stallType: 'ev' },
        isElectric: true,
      }),
    );
    expect(r.allowed).toBe(true);
  });

  it.each(['heavy', 'rv', 'trailer'] as const)(
    'rejects an oversized class (%s) in a standard stall',
    (vehicleClass) => {
      const r = validateStallAssignment(base({ vehicleClass }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/too large/i);
    },
  );

  it('allows an oversized class in an oversized stall', () => {
    const r = validateStallAssignment(
      base({
        vehicleClass: 'heavy',
        stall: { deletedAt: null, occupiedByImpoundId: null, stallType: 'oversized' },
      }),
    );
    expect(r.allowed).toBe(true);
  });

  it('covered / secure / hazmat stalls accept any size class', () => {
    for (const stallType of ['covered', 'secure', 'hazmat'] as const) {
      const r = validateStallAssignment(
        base({
          vehicleClass: 'heavy',
          stall: { deletedAt: null, occupiedByImpoundId: null, stallType },
        }),
      );
      expect(r.allowed).toBe(true);
    }
  });
});
