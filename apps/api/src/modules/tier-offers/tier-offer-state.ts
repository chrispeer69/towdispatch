/**
 * Pure state-machine helpers for the tier-offer lifecycle. No I/O — kept
 * separate from the services so the transition rules are unit-testable in
 * isolation (mirrors dynamic-pricing-helpers.ts / job-state-machine.ts).
 *
 * Offer machine (linear, with cancel as an escape from any live state):
 *
 *     draft ──▶ sent ──▶ event_active ──▶ event_concluded
 *       │        │            │
 *       └────────┴────────────┴──▶ cancelled
 *
 * Recipient machine:
 *
 *     pending_send ──▶ sent ──▶ delivered ──▶ opened
 *                       │          │            │
 *                       ├──────────┴────────────┴──▶ accepted   (terminal)
 *                       ├──────────┴────────────┴──▶ declined   (terminal)
 *                       ├──────────┴────────────┴──▶ expired    (terminal)
 *                       └──────────┴────────────┴──▶ revoked    (terminal)
 *     pending_send ──▶ bounced  (delivery failure; terminal-ish, S3)
 *     pending_send ──▶ revoked
 */
import type { TierOfferRecipientStatus, TierOfferStatus } from '@ustowdispatch/shared';

const OFFER_TRANSITIONS: Record<TierOfferStatus, readonly TierOfferStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['event_active', 'event_concluded', 'cancelled'],
  event_active: ['event_concluded', 'cancelled'],
  event_concluded: [],
  cancelled: [],
};

export const OFFER_TERMINAL_STATES: readonly TierOfferStatus[] = ['event_concluded', 'cancelled'];

export function canTransitionOffer(from: TierOfferStatus, to: TierOfferStatus): boolean {
  return OFFER_TRANSITIONS[from].includes(to);
}

export function isOfferTerminal(status: TierOfferStatus): boolean {
  return OFFER_TERMINAL_STATES.includes(status);
}

/** Recipient statuses that are "in flight" — sent but not yet resolved. */
export const RECIPIENT_IN_FLIGHT_STATES: readonly TierOfferRecipientStatus[] = [
  'sent',
  'delivered',
  'opened',
];

/** Recipient statuses from which an accept/decline response is allowed. */
export const RECIPIENT_RESPONDABLE_STATES: readonly TierOfferRecipientStatus[] = [
  'sent',
  'delivered',
  'opened',
];

/** Terminal recipient states — no further transition. */
export const RECIPIENT_TERMINAL_STATES: readonly TierOfferRecipientStatus[] = [
  'accepted',
  'declined',
  'expired',
  'revoked',
  'bounced',
];

export function isRecipientTerminal(status: TierOfferRecipientStatus): boolean {
  return RECIPIENT_TERMINAL_STATES.includes(status);
}

export function canRecipientRespond(status: TierOfferRecipientStatus): boolean {
  return RECIPIENT_RESPONDABLE_STATES.includes(status);
}

/** Recipients that should be revoked when an offer is cancelled. */
export function isRecipientRevocable(status: TierOfferRecipientStatus): boolean {
  return !isRecipientTerminal(status);
}
