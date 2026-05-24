/**
 * Thermal-event escalation matrix spec — thermalEventEscalation.
 *
 * odor = monitor; swelling = notify + secure; smoke/venting/sparking/flames =
 * full response. Conservative and fixed (no heuristics). See decisions doc.
 */
import { describe, expect, it } from 'vitest';
import { thermalEventEscalation } from './ev-rules.logic';

describe('thermalEventEscalation', () => {
  it('odor → monitor only (no fire dept / hazmat / evac / lockdown)', () => {
    expect(thermalEventEscalation('odor')).toEqual({
      fireDeptNotify: false,
      hazmatNotify: false,
      evacRequired: false,
      sceneLockdown: false,
    });
  });

  it('swelling → notify fire dept + secure scene, no forced evac yet', () => {
    expect(thermalEventEscalation('swelling')).toEqual({
      fireDeptNotify: true,
      hazmatNotify: false,
      evacRequired: false,
      sceneLockdown: true,
    });
  });

  it.each(['smoke', 'venting', 'sparking', 'flames'] as const)(
    '%s → full response (fire dept + hazmat + evac + lockdown)',
    (severity) => {
      expect(thermalEventEscalation(severity)).toEqual({
        fireDeptNotify: true,
        hazmatNotify: true,
        evacRequired: true,
        sceneLockdown: true,
      });
    },
  );
});
