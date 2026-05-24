/**
 * Pure release-workflow state machine for the yard module (Session 54). No
 * I/O — unit-tested directly. The service maps actions to DB writes and
 * handles idempotency; this decides whether a transition is legal.
 *
 * Happy path (4 steps): initiated → id_verified → lienholder_authorized →
 * payment_collected → gate_released. Cancellable from any non-terminal state.
 *
 * Gates (from the spec):
 *   - payment cannot be collected before ID is verified,
 *   - lienholder cannot be authorized before ID is verified,
 *   - the gate cannot be released without EITHER a collected payment OR a
 *     recorded lienholder authorization (insurance total-loss path).
 */
import type { ReleaseTransitionCheck, ReleaseWorkflowStatus } from '@ustowdispatch/shared';

export type ReleaseAction =
  | 'verify_id'
  | 'authorize_lienholder'
  | 'collect_payment'
  | 'gate_release'
  | 'cancel';

export interface ReleaseState {
  status: ReleaseWorkflowStatus;
  hasIdVerified: boolean;
  hasLienholderAuth: boolean;
  hasPayment: boolean;
}

const ok: ReleaseTransitionCheck = { allowed: true, reason: null };
const no = (reason: string): ReleaseTransitionCheck => ({ allowed: false, reason });

/**
 * May `action` be applied to a workflow currently in `state`? Idempotent
 * re-application of an already-satisfied step is the SERVICE's concern
 * (it returns the current row); this guard answers the legality question.
 */
export function evaluateReleaseTransition(
  state: ReleaseState,
  action: ReleaseAction,
): ReleaseTransitionCheck {
  if (state.status === 'cancelled') {
    return action === 'cancel' ? ok : no('Workflow is cancelled and cannot be modified.');
  }
  if (state.status === 'gate_released') {
    return action === 'gate_release'
      ? ok
      : no('Vehicle has already been released through the gate.');
  }

  switch (action) {
    case 'verify_id':
      return ok;
    case 'authorize_lienholder':
      return state.hasIdVerified
        ? ok
        : no('ID must be verified before recording lienholder authorization.');
    case 'collect_payment':
      return state.hasIdVerified ? ok : no('ID must be verified before collecting payment.');
    case 'gate_release':
      if (!state.hasIdVerified) return no('ID must be verified before gate release.');
      if (!state.hasPayment && !state.hasLienholderAuth) {
        return no(
          'Payment must be collected or lienholder authorization recorded before gate release.',
        );
      }
      return ok;
    case 'cancel':
      return ok;
    default:
      return no('Unknown release action.');
  }
}
