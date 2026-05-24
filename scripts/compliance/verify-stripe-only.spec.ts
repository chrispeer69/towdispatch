import { describe, expect, it } from 'vitest';
import { findRawCardFields } from './verify-stripe-only';

describe('findRawCardFields', () => {
  it('positive: flags raw card columns/fields', () => {
    expect(findRawCardFields("cardNumber: text('card_number')").length).toBeGreaterThan(0);
    expect(findRawCardFields('cvv: integer("cvv")').length).toBeGreaterThan(0);
    expect(findRawCardFields('<input name="security_code" />').length).toBeGreaterThan(0);
  });

  it('negative: allows the Stripe token path', () => {
    expect(findRawCardFields("paymentMethodId: text('payment_method_id')")).toHaveLength(0);
    expect(findRawCardFields('<CardElement options={opts} />')).toHaveLength(0);
    expect(findRawCardFields("stripeCustomerId: text('stripe_customer_id')")).toHaveLength(0);
  });

  it('negative: does not false-positive on lookalike words', () => {
    expect(findRawCardFields('const companyName = expand(panel);')).toHaveLength(0);
  });
});
