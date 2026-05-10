import { describe, expect, it } from 'vitest';
import {
  InvalidInvoiceTransitionError,
  assertCanTransition,
  canTransition,
  statusAfterPayment,
} from './invoice-state-machine.js';

describe('invoice state machine', () => {
  it('draft → issued is valid', () => {
    expect(canTransition('draft', 'issued')).toBe(true);
  });
  it('paid → draft is invalid', () => {
    expect(canTransition('paid', 'draft')).toBe(false);
    expect(() => assertCanTransition('paid', 'draft')).toThrow(InvalidInvoiceTransitionError);
  });
  it('void is terminal — refunded is not reachable from void', () => {
    expect(canTransition('void', 'refunded')).toBe(false);
  });
  it('paid → refunded is valid (credit-memo refund flow)', () => {
    expect(canTransition('paid', 'refunded')).toBe(true);
  });
  it('statusAfterPayment: full payment of issued → paid', () => {
    expect(
      statusAfterPayment({ current: 'issued', totalCents: 1000, newPaidCents: 1000, isOverdue: false }),
    ).toBe('paid');
  });
  it('statusAfterPayment: partial payment of issued → partially_paid', () => {
    expect(
      statusAfterPayment({ current: 'issued', totalCents: 1000, newPaidCents: 400, isOverdue: false }),
    ).toBe('partially_paid');
  });
  it('statusAfterPayment: partial payment + overdue → overdue', () => {
    expect(
      statusAfterPayment({ current: 'overdue', totalCents: 1000, newPaidCents: 400, isOverdue: true }),
    ).toBe('overdue');
  });
  it('statusAfterPayment: void stays void regardless of payments', () => {
    expect(
      statusAfterPayment({ current: 'void', totalCents: 1000, newPaidCents: 1000, isOverdue: false }),
    ).toBe('void');
  });
});
