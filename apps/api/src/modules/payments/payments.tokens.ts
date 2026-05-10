/**
 * DI tokens for the payments module. The provider is supplied by a factory in
 * payments.module.ts that picks the real Stripe SDK-backed implementation
 * when STRIPE_SECRET_KEY is configured, and the in-memory stub otherwise.
 */
export const PAYMENT_PROVIDER = Symbol.for('payments.PaymentProvider');
