/**
 * Pure state-machine unit tests for the tier-offer lifecycle. No DB, no
 * Nest container — exercises the transition table + terminal/respondable
 * predicates directly (mirrors job-state-machine.spec.ts).
 */
import type { TierOfferRecipientStatus, TierOfferStatus } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  canRecipientRespond,
  canTransitionOffer,
  isOfferTerminal,
  isRecipientRevocable,
  isRecipientTerminal,
} from './tier-offer-state.js';

describe('tier-offer state machine — offer transitions', () => {
  it('allows the linear happy path', () => {
    expect(canTransitionOffer('draft', 'sent')).toBe(true);
    expect(canTransitionOffer('sent', 'event_active')).toBe(true);
    expect(canTransitionOffer('event_active', 'event_concluded')).toBe(true);
  });

  it('allows sent to jump straight to event_concluded (short events)', () => {
    expect(canTransitionOffer('sent', 'event_concluded')).toBe(true);
  });

  it('allows cancel from any live state', () => {
    expect(canTransitionOffer('draft', 'cancelled')).toBe(true);
    expect(canTransitionOffer('sent', 'cancelled')).toBe(true);
    expect(canTransitionOffer('event_active', 'cancelled')).toBe(true);
  });

  it('forbids backward and skip-illegal transitions', () => {
    expect(canTransitionOffer('sent', 'draft')).toBe(false);
    expect(canTransitionOffer('event_active', 'sent')).toBe(false);
    expect(canTransitionOffer('draft', 'event_active')).toBe(false);
    expect(canTransitionOffer('draft', 'event_concluded')).toBe(false);
  });

  it('treats event_concluded and cancelled as terminal', () => {
    const terminal: TierOfferStatus[] = ['event_concluded', 'cancelled'];
    for (const from of terminal) {
      expect(isOfferTerminal(from)).toBe(true);
      const allStates: TierOfferStatus[] = [
        'draft',
        'sent',
        'event_active',
        'event_concluded',
        'cancelled',
      ];
      for (const to of allStates) {
        expect(canTransitionOffer(from, to)).toBe(false);
      }
    }
  });

  it('treats live states as non-terminal', () => {
    expect(isOfferTerminal('draft')).toBe(false);
    expect(isOfferTerminal('sent')).toBe(false);
    expect(isOfferTerminal('event_active')).toBe(false);
  });
});

describe('tier-offer state machine — recipient predicates', () => {
  const allStatuses: TierOfferRecipientStatus[] = [
    'pending_send',
    'sent',
    'delivered',
    'bounced',
    'opened',
    'accepted',
    'declined',
    'expired',
    'revoked',
  ];

  it('permits responses only from sent/delivered/opened', () => {
    const respondable: TierOfferRecipientStatus[] = ['sent', 'delivered', 'opened'];
    for (const s of allStatuses) {
      expect(canRecipientRespond(s)).toBe(respondable.includes(s));
    }
  });

  it('marks accepted/declined/expired/revoked/bounced terminal', () => {
    const terminal: TierOfferRecipientStatus[] = [
      'accepted',
      'declined',
      'expired',
      'revoked',
      'bounced',
    ];
    for (const s of allStatuses) {
      expect(isRecipientTerminal(s)).toBe(terminal.includes(s));
    }
  });

  it('revokes only non-terminal recipients on offer cancel', () => {
    expect(isRecipientRevocable('pending_send')).toBe(true);
    expect(isRecipientRevocable('sent')).toBe(true);
    expect(isRecipientRevocable('opened')).toBe(true);
    expect(isRecipientRevocable('accepted')).toBe(false);
    expect(isRecipientRevocable('declined')).toBe(false);
    expect(isRecipientRevocable('bounced')).toBe(false);
  });

  it('never lets a terminal recipient respond', () => {
    expect(canRecipientRespond('accepted')).toBe(false);
    expect(canRecipientRespond('declined')).toBe(false);
    expect(canRecipientRespond('expired')).toBe(false);
    expect(canRecipientRespond('pending_send')).toBe(false);
  });
});
