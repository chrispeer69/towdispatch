/**
 * Unit coverage for the StubPaymentProvider — keeps the stub honest about
 * the PaymentProvider contract and locks in the HMAC layout the test
 * webhook flow uses.
 */
import { describe, expect, it } from 'vitest';
import { StubPaymentProvider } from './stub.provider.js';

describe('StubPaymentProvider', () => {
  it('createPaymentIntent returns a deterministic, requires_payment_method intent', async () => {
    const p = new StubPaymentProvider();
    const r = await p.createPaymentIntent({
      connectedAccountId: 'acct_1',
      amountCents: 12_345,
      currency: 'usd',
      invoiceId: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000099',
    });
    expect(r.externalId).toMatch(/^pi_stub_/);
    expect(r.status).toBe('requires_payment_method');
    expect(r.clientSecret).toMatch(/_secret_/);
    expect(r.amountCents).toBe(12_345);
    expect(r.currency).toBe('USD');
    expect(p.intents.size).toBe(1);
  });

  it('confirmPaymentIntent flips status to succeeded and sets a chargeId', async () => {
    const p = new StubPaymentProvider();
    const created = await p.createPaymentIntent({
      connectedAccountId: 'acct_1',
      amountCents: 5_000,
      currency: 'usd',
      invoiceId: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000099',
    });
    const confirmed = await p.confirmPaymentIntent({
      paymentIntentId: created.externalId,
      connectedAccountId: 'acct_1',
      paymentMethodId: 'pm_test_123',
    });
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.chargeId).toMatch(/^ch_stub_/);
    expect(confirmed.paymentMethodId).toBe('pm_test_123');
  });

  it('off-session card-on-file path returns succeeded immediately', async () => {
    const p = new StubPaymentProvider();
    const r = await p.createPaymentIntent({
      connectedAccountId: 'acct_1',
      amountCents: 7_500,
      currency: 'usd',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      paymentMethodId: 'pm_saved_1',
      offSession: true,
    });
    expect(r.status).toBe('succeeded');
    expect(r.chargeId).toMatch(/^ch_stub_/);
    expect(r.feeCents).toBeGreaterThan(0);
  });

  it('refund returns succeeded for a known intent', async () => {
    const p = new StubPaymentProvider();
    const intent = await p.createPaymentIntent({
      connectedAccountId: 'acct_1',
      amountCents: 10_000,
      currency: 'usd',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
    });
    const r = await p.refund({
      paymentIntentId: intent.externalId,
      connectedAccountId: 'acct_1',
      amountCents: 4_000,
    });
    expect(r.amountCents).toBe(4_000);
    expect(r.status).toBe('succeeded');
    expect(r.externalId).toMatch(/^re_stub_/);
  });

  it('refund of an unknown intent throws', async () => {
    const p = new StubPaymentProvider();
    await expect(
      p.refund({ paymentIntentId: 'pi_unknown', connectedAccountId: 'acct_1' }),
    ).rejects.toThrow(/unknown intent/);
  });

  it('createConnectedAccount deterministically derives an acct_test_<id>', async () => {
    const p = new StubPaymentProvider();
    const r = await p.createConnectedAccount({
      tenantId: '00000000-0000-0000-0000-000000000abc',
      tenantName: 'Test Tow',
      email: 'test@example.com',
    });
    expect(r.accountId).toMatch(/^acct_test_/);
    const status = await p.getConnectedAccountStatus(r.accountId);
    expect(status.chargesEnabled).toBe(true);
  });

  it('verifyWebhookSignature accepts a signed payload and rejects a tampered one', () => {
    const p = new StubPaymentProvider();
    const secret = 'whsec_unit_test';
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
    const sig = StubPaymentProvider.signPayload(payload, secret);
    const ev = p.verifyWebhookSignature(payload, sig, secret);
    expect(ev.id).toBe('evt_1');
    expect(ev.type).toBe('payment_intent.succeeded');
    expect(() => p.verifyWebhookSignature(`${payload}X`, sig, secret)).toThrow(
      /signature verification failed/,
    );
  });

  it('verifyWebhookSignature rejects a malformed header', () => {
    const p = new StubPaymentProvider();
    expect(() => p.verifyWebhookSignature('{}', 'this-is-not-a-stripe-header', 'whsec_x')).toThrow(
      /Invalid stripe signature/,
    );
  });

  it('createCustomer + createSetupIntent populate the in-memory maps', async () => {
    const p = new StubPaymentProvider();
    const c = await p.createCustomer({
      tenantId: 't1',
      connectedAccountId: 'acct_1',
      name: 'Alice',
      email: 'a@example.com',
    });
    expect(c.externalId).toMatch(/^cus_stub_/);
    const si = await p.createSetupIntent({
      connectedAccountId: 'acct_1',
      customerExternalId: c.externalId,
    });
    expect(si.externalId).toMatch(/^seti_stub_/);
    expect(p.customers.has(c.externalId)).toBe(true);
    expect(p.setupIntents.has(si.externalId)).toBe(true);
  });

  it('detachPaymentMethod is a no-op (no throw)', async () => {
    const p = new StubPaymentProvider();
    await expect(
      p.detachPaymentMethod({ connectedAccountId: 'acct_1', paymentMethodId: 'pm_x' }),
    ).resolves.toBeUndefined();
  });

  it('createOnboardingLink returns a URL containing the account id', async () => {
    const p = new StubPaymentProvider();
    const r = await p.createOnboardingLink({
      accountId: 'acct_test_xyz',
      refreshUrl: 'http://x/refresh',
      returnUrl: 'http://x/return',
    });
    expect(r.url).toContain('acct_test_xyz');
    expect(r.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
