/**
 * Customer Self-Serve Portal — release-intent state machine + contracts
 * (Session 55).
 *
 * A release intent tracks an owner's online "I want my vehicle back" flow:
 *   initiated -> id_provided -> paid -> ready_for_gate -> gate_completed
 * with `cancelled` reachable from the pre-payment states. Payments are
 * full-only in v1 (SESSION_55_DECISIONS.md D8): a single succeeded PaymentIntent
 * flips paid -> ready_for_gate. `ready_for_gate` is the handoff signal the yard
 * gate workflow consumes; `gate_completed` is set by the operator at pickup.
 *
 * The transition table is pure and shared so the API service and its tests
 * enforce exactly the same rules.
 */
import { z } from 'zod';

export const portalReleaseIntentStatusValues = [
  'initiated',
  'id_provided',
  'paid',
  'ready_for_gate',
  'cancelled',
  'gate_completed',
] as const;
export type PortalReleaseIntentStatus = (typeof portalReleaseIntentStatusValues)[number];

const TRANSITIONS: Record<PortalReleaseIntentStatus, readonly PortalReleaseIntentStatus[]> = {
  initiated: ['id_provided', 'cancelled'],
  id_provided: ['paid', 'cancelled'],
  paid: ['ready_for_gate'],
  ready_for_gate: ['gate_completed'],
  cancelled: [],
  gate_completed: [],
};

/** Pure guard: is `from -> to` a legal release-intent transition? */
export function canTransitionReleaseIntent(
  from: PortalReleaseIntentStatus,
  to: PortalReleaseIntentStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalReleaseIntentStatus(status: PortalReleaseIntentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export const portalReleaseIntentDtoSchema = z.object({
  id: z.string().uuid(),
  impoundId: z.string().uuid(),
  status: z.enum(portalReleaseIntentStatusValues),
  totalDueCents: z.number().int(),
  paidCents: z.number().int(),
  stripePaymentIntentId: z.string().nullable(),
  initiatedAt: z.string().datetime(),
  readyForGateAt: z.string().datetime().nullable(),
  gateCompletedAt: z.string().datetime().nullable(),
});
export type PortalReleaseIntentDto = z.infer<typeof portalReleaseIntentDtoSchema>;
