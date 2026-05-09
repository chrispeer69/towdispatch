/**
 * PaymentProvider — abstraction over card-present and card-not-present
 * processors (Stripe first; Adyen, Square, etc. later).
 *
 * The interface is built around PaymentIntents (auth + capture) because that
 * model maps cleanly to roadside scenarios: authorize at job creation, capture
 * on completion, refund on dispute. Saved-payment-method support is included
 * because motor-club work often involves stored member payment methods.
 */
import type { IntegrationProvider } from '../types.js';

export interface PaymentProviderCredentials {
  config: Record<string, unknown>;
}

export interface PaymentCustomerRef {
  externalId: string;
  email?: string;
  name?: string;
}

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: string;
  customer?: PaymentCustomerRef;
  description?: string;
  metadata?: Record<string, string>;
  /** When true, the intent is authorized but not captured. */
  manualCapture?: boolean;
}

export interface PaymentIntent {
  externalId: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'succeeded'
    | 'canceled';
  amountCents: number;
  currency: string;
  clientSecret?: string;
}

export interface RefundInput {
  paymentIntentExternalId: string;
  amountCents?: number;
  reason?: string;
}

export interface Refund {
  externalId: string;
  paymentIntentExternalId: string;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentProvider extends IntegrationProvider {
  createPaymentIntent(
    creds: PaymentProviderCredentials,
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntent>;
  capturePaymentIntent(
    creds: PaymentProviderCredentials,
    externalId: string,
    amountCents?: number,
  ): Promise<PaymentIntent>;
  cancelPaymentIntent(
    creds: PaymentProviderCredentials,
    externalId: string,
  ): Promise<PaymentIntent>;
  refund(creds: PaymentProviderCredentials, input: RefundInput): Promise<Refund>;
  getPaymentIntent(
    creds: PaymentProviderCredentials,
    externalId: string,
  ): Promise<PaymentIntent | null>;
}
