/**
 * DI tokens for the payments module. The provider is supplied by a factory in
 * payments.module.ts that picks the real Stripe SDK-backed implementation when
 * PAYMENTS_PROVIDER=live (and refuses to boot if keys are missing), and the
 * in-memory stub otherwise (the default).
 */
export const PAYMENT_PROVIDER = Symbol.for('payments.PaymentProvider');
