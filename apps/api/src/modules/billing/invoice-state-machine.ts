/**
 * Invoice status state machine. Mirrors job-state-machine.ts (Session 4)
 * for shape and feel — pure functions, no DB or framework dependencies.
 */
import type { InvoiceStatus } from '@towcommand/shared';

export const INVOICE_TERMINAL: ReadonlySet<InvoiceStatus> = new Set(['paid', 'void', 'refunded']);

const transitions: Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>> = {
  draft: ['issued', 'void'],
  issued: ['sent', 'partially_paid', 'paid', 'overdue', 'void'],
  sent: ['partially_paid', 'paid', 'overdue', 'void'],
  partially_paid: ['paid', 'overdue', 'void'],
  paid: ['refunded'],
  overdue: ['partially_paid', 'paid', 'void'],
  void: [],
  refunded: [],
};

export class InvalidInvoiceTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super(`Invoice cannot transition from ${from} to ${to}`);
    this.name = 'InvalidInvoiceTransitionError';
  }
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  return transitions[from].includes(to);
}

export function assertCanTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new InvalidInvoiceTransitionError(from, to);
}

/**
 * Compute the post-payment status for an invoice. Pure: takes the totals and
 * returns the new status (or the current one if no movement is required).
 */
export function statusAfterPayment(args: {
  current: InvoiceStatus;
  totalCents: number;
  newPaidCents: number;
  isOverdue: boolean;
}): InvoiceStatus {
  if (args.current === 'void' || args.current === 'refunded') return args.current;
  if (args.newPaidCents >= args.totalCents && args.totalCents > 0) {
    return 'paid';
  }
  if (args.newPaidCents > 0) {
    return args.isOverdue ? 'overdue' : 'partially_paid';
  }
  if (args.isOverdue) return 'overdue';
  // Nothing paid yet — keep issued/sent/draft.
  return args.current === 'paid' ? 'partially_paid' : args.current;
}
