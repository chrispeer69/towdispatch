import type { JobStatus } from '@towdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  INVALID_TRANSITIONS,
  InvalidJobTransitionError,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  allowedTransitions,
  assertCanTransition,
  canTransition,
  isTerminal,
} from './job-state-machine.js';

describe('job state machine', () => {
  describe('valid transitions', () => {
    const expected: ReadonlyArray<readonly [JobStatus, JobStatus]> = [
      ['new', 'dispatched'],
      ['new', 'cancelled'],
      ['dispatched', 'enroute'],
      ['dispatched', 'new'],
      ['dispatched', 'cancelled'],
      ['dispatched', 'goa'],
      ['enroute', 'on_scene'],
      ['enroute', 'cancelled'],
      ['enroute', 'goa'],
      ['on_scene', 'in_progress'],
      ['on_scene', 'goa'],
      ['on_scene', 'cancelled'],
      ['in_progress', 'completed'],
      ['in_progress', 'cancelled'],
    ];

    it('exposes the expected valid-transition set', () => {
      expect(new Set(VALID_TRANSITIONS.map(([a, b]) => `${a}->${b}`))).toEqual(
        new Set(expected.map(([a, b]) => `${a}->${b}`)),
      );
    });

    for (const [from, to] of expected) {
      it(`canTransition('${from}', '${to}') === true`, () => {
        expect(canTransition(from, to)).toBe(true);
        expect(() => assertCanTransition(from, to)).not.toThrow();
      });
    }
  });

  describe('invalid transitions', () => {
    it('rejects every (from, to) pair NOT in the valid set', () => {
      expect(INVALID_TRANSITIONS.length).toBeGreaterThan(0);
      for (const [from, to] of INVALID_TRANSITIONS) {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertCanTransition(from, to)).toThrow(InvalidJobTransitionError);
      }
    });

    it('rejects same-state transitions (no idempotent loopbacks)', () => {
      const states: JobStatus[] = [
        'new',
        'dispatched',
        'enroute',
        'on_scene',
        'in_progress',
        'completed',
        'cancelled',
        'goa',
      ];
      for (const s of states) {
        expect(canTransition(s, s)).toBe(false);
      }
    });

    it('terminal states cannot leave their terminal', () => {
      for (const t of ['completed', 'cancelled', 'goa'] as const) {
        expect(allowedTransitions(t)).toEqual([]);
      }
    });
  });

  describe('helpers', () => {
    it('isTerminal correctly identifies the three terminal statuses', () => {
      expect(isTerminal('completed')).toBe(true);
      expect(isTerminal('cancelled')).toBe(true);
      expect(isTerminal('goa')).toBe(true);
      expect(isTerminal('new')).toBe(false);
      expect(isTerminal('dispatched')).toBe(false);
      expect(isTerminal('enroute')).toBe(false);
      expect(isTerminal('on_scene')).toBe(false);
      expect(isTerminal('in_progress')).toBe(false);
    });

    it('TERMINAL_STATUSES set matches isTerminal()', () => {
      expect(TERMINAL_STATUSES.has('completed')).toBe(true);
      expect(TERMINAL_STATUSES.has('cancelled')).toBe(true);
      expect(TERMINAL_STATUSES.has('goa')).toBe(true);
    });

    it('InvalidJobTransitionError carries from and to', () => {
      try {
        assertCanTransition('completed', 'in_progress');
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidJobTransitionError);
        if (err instanceof InvalidJobTransitionError) {
          expect(err.from).toBe('completed');
          expect(err.to).toBe('in_progress');
        }
      }
    });
  });

  describe('happy-path walk', () => {
    it('walks new -> dispatched -> enroute -> on_scene -> in_progress -> completed', () => {
      const path: JobStatus[] = [
        'new',
        'dispatched',
        'enroute',
        'on_scene',
        'in_progress',
        'completed',
      ];
      for (let i = 0; i < path.length - 1; i++) {
        expect(canTransition(path[i] as JobStatus, path[i + 1] as JobStatus)).toBe(true);
      }
    });
  });
});
