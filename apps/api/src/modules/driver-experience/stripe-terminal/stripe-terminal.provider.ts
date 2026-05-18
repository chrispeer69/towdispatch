/**
 * StripeTerminalProvider — the surface the driver-app uses to drive an
 * in-vehicle card reader. The real implementation (Session 3) talks to
 * Stripe Terminal; for Session 2 we ship a stub that records intent
 * lifecycle in-memory and returns synthetic ids. The stub keeps the
 * full HTTP shape working so the driver app + dispatch can be exercised
 * end-to-end without real reader hardware.
 *
 * Contract intentionally small: createIntent → returns immediately
 * authorized; capture → flips to captured; cancel → flips to cancelled.
 * Failure modes (declined card, lost connection, etc.) land with the
 * real provider, not here.
 */
import type { JobFieldPaymentMethod } from '@ustowdispatch/shared';

export interface CreateTerminalIntentInput {
  tenantId: string;
  jobId: string;
  amountCents: number;
  tipCents: number;
  currency: string;
  paymentMethod: JobFieldPaymentMethod;
  /** Optional reader id; the real impl routes the intent to this reader. */
  terminalReaderId?: string | undefined;
}

export interface TerminalIntentResult {
  paymentIntentId: string;
  status: 'authorized' | 'captured' | 'cancelled' | 'failed';
  /** Brand-friendly metadata when available (stub returns a fake brand/last4). */
  cardBrand: string | null;
  cardLast4: string | null;
}

export interface CaptureTerminalIntentInput {
  paymentIntentId: string;
  amountToCaptureCents?: number;
}

export interface CancelTerminalIntentInput {
  paymentIntentId: string;
}

export interface StripeTerminalProvider {
  readonly id: string;
  createIntent(input: CreateTerminalIntentInput): Promise<TerminalIntentResult>;
  capture(input: CaptureTerminalIntentInput): Promise<TerminalIntentResult>;
  cancel(input: CancelTerminalIntentInput): Promise<TerminalIntentResult>;
}
