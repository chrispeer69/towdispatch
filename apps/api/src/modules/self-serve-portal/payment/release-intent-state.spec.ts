import {
  type PortalReleaseIntentStatus,
  canTransitionReleaseIntent,
  isTerminalReleaseIntentStatus,
  portalReleaseIntentStatusValues,
} from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';

describe('release-intent state machine', () => {
  it('allows the happy path initiated → … → gate_completed', () => {
    const path: PortalReleaseIntentStatus[] = [
      'initiated',
      'id_provided',
      'paid',
      'ready_for_gate',
      'gate_completed',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(
        canTransitionReleaseIntent(
          path[i] as PortalReleaseIntentStatus,
          path[i + 1] as PortalReleaseIntentStatus,
        ),
      ).toBe(true);
    }
  });

  it('allows cancellation only before payment', () => {
    expect(canTransitionReleaseIntent('initiated', 'cancelled')).toBe(true);
    expect(canTransitionReleaseIntent('id_provided', 'cancelled')).toBe(true);
    expect(canTransitionReleaseIntent('paid', 'cancelled')).toBe(false);
    expect(canTransitionReleaseIntent('ready_for_gate', 'cancelled')).toBe(false);
  });

  it('forbids skipping payment (id_provided cannot jump to ready_for_gate)', () => {
    expect(canTransitionReleaseIntent('id_provided', 'ready_for_gate')).toBe(false);
  });

  it('forbids going backwards', () => {
    expect(canTransitionReleaseIntent('paid', 'id_provided')).toBe(false);
    expect(canTransitionReleaseIntent('ready_for_gate', 'paid')).toBe(false);
  });

  it('treats cancelled and gate_completed as terminal', () => {
    expect(isTerminalReleaseIntentStatus('cancelled')).toBe(true);
    expect(isTerminalReleaseIntentStatus('gate_completed')).toBe(true);
    for (const s of ['initiated', 'id_provided', 'paid', 'ready_for_gate'] as const) {
      expect(isTerminalReleaseIntentStatus(s)).toBe(false);
    }
  });

  it('no transition out of a terminal state', () => {
    for (const to of portalReleaseIntentStatusValues) {
      expect(canTransitionReleaseIntent('gate_completed', to)).toBe(false);
      expect(canTransitionReleaseIntent('cancelled', to)).toBe(false);
    }
  });
});
