/**
 * StubStripeTerminalProvider — in-memory implementation of
 * StripeTerminalProvider for dev / test. createIntent returns instantly
 * with a `pi_stub_<uuidv7>` id in status='authorized'. capture / cancel
 * walk the local state machine without making any HTTP calls.
 *
 * A future replacement will wire @stripe/stripe-terminal-sdk; the
 * follow-up PR is tracked at:
 *   "field-payments: replace stub with real Stripe Terminal SDK"
 */
import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import type {
  CancelTerminalIntentInput,
  CaptureTerminalIntentInput,
  CreateTerminalIntentInput,
  StripeTerminalProvider,
  TerminalIntentResult,
} from './stripe-terminal.provider.js';

interface StubIntent {
  paymentIntentId: string;
  amountCents: number;
  tipCents: number;
  status: TerminalIntentResult['status'];
  cardBrand: string | null;
  cardLast4: string | null;
}

@Injectable()
export class StubStripeTerminalProvider implements StripeTerminalProvider {
  readonly id = 'stub';
  private readonly intents = new Map<string, StubIntent>();

  async createIntent(input: CreateTerminalIntentInput): Promise<TerminalIntentResult> {
    const paymentIntentId = `pi_stub_${uuidv7()}`;
    const intent: StubIntent = {
      paymentIntentId,
      amountCents: input.amountCents,
      tipCents: input.tipCents,
      status: 'authorized',
      cardBrand: input.paymentMethod === 'cash' ? null : 'visa',
      cardLast4: input.paymentMethod === 'cash' ? null : '4242',
    };
    this.intents.set(paymentIntentId, intent);
    return projection(intent);
  }

  async capture(input: CaptureTerminalIntentInput): Promise<TerminalIntentResult> {
    const intent = this.intents.get(input.paymentIntentId);
    if (!intent) throw new Error(`unknown payment intent: ${input.paymentIntentId}`);
    if (intent.status !== 'authorized') {
      throw new Error(`cannot capture intent in status ${intent.status}`);
    }
    intent.status = 'captured';
    return projection(intent);
  }

  async cancel(input: CancelTerminalIntentInput): Promise<TerminalIntentResult> {
    const intent = this.intents.get(input.paymentIntentId);
    if (!intent) throw new Error(`unknown payment intent: ${input.paymentIntentId}`);
    if (intent.status === 'captured') {
      throw new Error('cannot cancel a captured intent');
    }
    intent.status = 'cancelled';
    return projection(intent);
  }
}

function projection(i: StubIntent): TerminalIntentResult {
  return {
    paymentIntentId: i.paymentIntentId,
    status: i.status,
    cardBrand: i.cardBrand,
    cardLast4: i.cardLast4,
  };
}
