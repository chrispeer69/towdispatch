/**
 * Live Stripe SDK integration spec — proves the real StripePaymentProvider
 * wires up against Stripe test mode. Skipped entirely unless a Stripe test-mode
 * secret key is present, so CI and dev machines without keys are unaffected.
 *
 * Enable locally:
 *   STRIPE_TEST_SECRET_KEY=sk_test_xxx pnpm --filter @ustowdispatch/api test
 *
 * Optional richer coverage (destination charge + refund) needs a connected
 * account that has already completed onboarding (charges enabled). Provide its
 * id to opt in; otherwise those cases skip:
 *   STRIPE_TEST_CONNECTED_ACCOUNT=acct_xxx
 *
 * What this proves that the stub-driven payments.spec.ts cannot:
 *   - the Stripe Node SDK is constructed and reachable with our config
 *   - webhook signature verification uses the real constructEvent (good + bad)
 *   - Connect account creation returns the expected DTO shape
 *   - (opt-in) a destination payment intent + refund round-trips
 */
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripePaymentProvider } from '../../src/modules/payments/stripe.provider.js';

const LIVE_KEY = process.env.STRIPE_TEST_SECRET_KEY;
const CONNECTED_ACCOUNT = process.env.STRIPE_TEST_CONNECTED_ACCOUNT;
const describeLive = LIVE_KEY ? describe : describe.skip;
const describeCharge = LIVE_KEY && CONNECTED_ACCOUNT ? describe : describe.skip;

// Guard against accidentally running this against a live-mode key.
if (LIVE_KEY?.startsWith('sk_live_')) {
  throw new Error(
    'STRIPE_TEST_SECRET_KEY is a LIVE key (sk_live_). This spec creates real ' +
      'objects in Stripe — use a test-mode key (sk_test_) only.',
  );
}

describeLive('StripePaymentProvider (live Stripe test mode)', () => {
  // Constructed in beforeAll, not at suite-collection time: Vitest still runs a
  // skipped suite's body to register tests, and the provider constructor throws
  // without a key — so eager construction would crash collection on key-less CI.
  let provider: StripePaymentProvider;
  // A throwaway client only used to sign synthetic webhook payloads the way
  // Stripe would, so we can verify the provider's constructEvent path.
  let signingClient: Stripe;
  const createdAccountIds: string[] = [];

  beforeAll(() => {
    provider = new StripePaymentProvider(LIVE_KEY as string);
    signingClient = new Stripe(LIVE_KEY as string);
  });

  afterAll(async () => {
    // Test-mode connected accounts can be cleaned up to keep the sandbox tidy.
    for (const id of createdAccountIds) {
      await signingClient.accounts.del(id).catch(() => {});
    }
  });

  // ----- Webhook signature verification (no network) -----

  it('verifies a correctly signed webhook payload via the real SDK', () => {
    const secret = `whsec_livespec_${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify({
      id: 'evt_live_spec_1',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { id: 'pi_live_spec_1', amount: 4242 } },
    });
    const header = signingClient.webhooks.generateTestHeaderString({ payload, secret });
    const event = provider.verifyWebhookSignature(payload, header, secret);
    expect(event.id).toBe('evt_live_spec_1');
    expect(event.type).toBe('payment_intent.succeeded');
    expect((event.data.object as { id: string }).id).toBe('pi_live_spec_1');
  });

  it('rejects a tampered webhook payload', () => {
    const secret = `whsec_livespec_${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify({ id: 'evt_live_spec_2', type: 'noop' });
    const header = signingClient.webhooks.generateTestHeaderString({ payload, secret });
    const tampered = payload.replace('noop', 'tampered');
    expect(() => provider.verifyWebhookSignature(tampered, header, secret)).toThrow();
  });

  // ----- Connect onboarding (network: Stripe test mode) -----

  it('creates a connected express account and reports its status shape', async () => {
    const { accountId } = await provider.createConnectedAccount({
      tenantId: '00000000-0000-0000-0000-0000000000aa',
      tenantName: 'Live Spec Towing',
      email: `live-spec-${Date.now()}@example.com`,
    });
    createdAccountIds.push(accountId);
    expect(accountId).toMatch(/^acct_/);

    const status = await provider.getConnectedAccountStatus(accountId);
    expect(status.accountId).toBe(accountId);
    expect(typeof status.chargesEnabled).toBe('boolean');
    expect(typeof status.payoutsEnabled).toBe('boolean');
    expect(Array.isArray(status.requirementsCurrentlyDue)).toBe(true);
  });
});

describeCharge('StripePaymentProvider destination charge + refund (live test mode)', () => {
  let provider: StripePaymentProvider;

  beforeAll(() => {
    provider = new StripePaymentProvider(LIVE_KEY as string);
  });

  it('creates a destination payment intent and refunds it', async () => {
    const created = await provider.createPaymentIntent({
      connectedAccountId: CONNECTED_ACCOUNT as string,
      amountCents: 5_000,
      currency: 'usd',
      invoiceId: '00000000-0000-0000-0000-0000000000b1',
      tenantId: '00000000-0000-0000-0000-0000000000b2',
      paymentMethodId: 'pm_card_visa',
      offSession: true,
      applicationFeeCents: 150,
    });
    expect(created.externalId).toMatch(/^pi_/);
    expect(created.amountCents).toBe(5_000);
    expect(['succeeded', 'requires_capture', 'processing']).toContain(created.status);

    const refund = await provider.refund({
      paymentIntentId: created.externalId,
      connectedAccountId: CONNECTED_ACCOUNT as string,
      amountCents: 2_000,
      reason: 'requested_by_customer',
    });
    expect(refund.externalId).toMatch(/^re_/);
    expect(refund.amountCents).toBe(2_000);
  });
});
