/**
 * StubPaymentProvider — in-memory PaymentProvider used in dev when
 * STRIPE_SECRET_KEY is not configured, and as the default in tests.
 *
 * Behavior:
 *   - createPaymentIntent returns a deterministic pi_test_<ulid> with
 *     status=requires_payment_method and a fake client_secret.
 *   - confirmPaymentIntent flips status to succeeded.
 *   - refund returns succeeded with the requested amount.
 *   - verifyWebhookSignature performs an HMAC-SHA256 check using a custom
 *     header layout `t=<ts>,v1=<hex>` (Stripe-compatible) so integration tests
 *     can exercise the real webhook controller without the SDK.
 *
 * Tests can also reach into the public `intents`, `refunds`, `customers`,
 * `setupIntents` maps to assert side-effects.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  CapturePaymentInput,
  ConfirmPaymentInput,
  ConnectedAccountStatus,
  CreateConnectedAccountInput,
  CreateCustomerInput,
  CreatePaymentIntentInput,
  CreateSetupIntentInput,
  DetachPaymentMethodInput,
  OnboardingLinkInput,
  OnboardingLinkResult,
  PaymentIntentResult,
  PaymentIntentStatus,
  PaymentProvider,
  ProviderDescriptor,
  RefundInput,
  RefundResult,
  SetupIntentResult,
  WebhookEvent,
} from './provider.js';

const PROVIDER_DESCRIPTOR: ProviderDescriptor = {
  id: 'stripe-stub',
  displayName: 'Stripe (stub)',
  vendor: 'stripe',
};

interface StoredIntent extends PaymentIntentResult {
  connectedAccountId: string;
  invoiceId: string;
  tenantId: string;
}

export class StubPaymentProvider implements PaymentProvider {
  readonly descriptor = PROVIDER_DESCRIPTOR;

  readonly intents = new Map<string, StoredIntent>();
  readonly refunds = new Map<string, RefundResult>();
  readonly customers = new Map<string, { tenantId: string; name: string; email?: string }>();
  readonly setupIntents = new Map<string, { customer: string; account: string }>();
  readonly accounts = new Map<string, ConnectedAccountStatus>();

  private seq = 0;

  // ----- Connect -----

  async createConnectedAccount(input: CreateConnectedAccountInput): Promise<{ accountId: string }> {
    const id = `acct_test_${input.tenantId.replace(/-/g, '').slice(0, 16)}`;
    this.accounts.set(id, {
      accountId: id,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsCurrentlyDue: [],
    });
    return { accountId: id };
  }

  async getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
    return (
      this.accounts.get(accountId) ?? {
        accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsCurrentlyDue: [],
      }
    );
  }

  async createOnboardingLink(input: OnboardingLinkInput): Promise<OnboardingLinkResult> {
    return {
      url: `https://connect.stripe.test/onboard/${input.accountId}`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // ----- Payment intents -----

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    this.seq += 1;
    const id = `pi_stub_${Date.now().toString(36)}${this.seq}`;
    const status: PaymentIntentStatus =
      input.paymentMethodId && input.offSession ? 'succeeded' : 'requires_payment_method';
    const intent: StoredIntent = {
      externalId: id,
      status,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      clientSecret: `${id}_secret_${randomBytes(4).toString('hex')}`,
      chargeId: status === 'succeeded' ? `ch_stub_${id.slice(8)}` : null,
      feeCents: status === 'succeeded' ? Math.round(input.amountCents * 0.029) + 30 : null,
      paymentMethodId: input.paymentMethodId ?? null,
      connectedAccountId: input.connectedAccountId,
      invoiceId: input.invoiceId,
      tenantId: input.tenantId,
    };
    this.intents.set(id, intent);
    return intent;
  }

  async confirmPaymentIntent(input: ConfirmPaymentInput): Promise<PaymentIntentResult> {
    const i = this.intents.get(input.paymentIntentId);
    if (!i) throw new Error(`unknown intent ${input.paymentIntentId}`);
    i.status = 'succeeded';
    i.chargeId = `ch_stub_${i.externalId.slice(8)}`;
    if (input.paymentMethodId) i.paymentMethodId = input.paymentMethodId;
    return i;
  }

  async capturePayment(input: CapturePaymentInput): Promise<PaymentIntentResult> {
    const i = this.intents.get(input.paymentIntentId);
    if (!i) throw new Error(`unknown intent ${input.paymentIntentId}`);
    i.status = 'succeeded';
    return i;
  }

  async getPaymentStatus(paymentIntentId: string): Promise<PaymentIntentResult | null> {
    return this.intents.get(paymentIntentId) ?? null;
  }

  // ----- Refunds -----

  async refund(input: RefundInput): Promise<RefundResult> {
    const i = this.intents.get(input.paymentIntentId);
    if (!i) throw new Error(`unknown intent ${input.paymentIntentId}`);
    this.seq += 1;
    const id = `re_stub_${Date.now().toString(36)}${this.seq}`;
    const refund: RefundResult = {
      externalId: id,
      paymentIntentId: input.paymentIntentId,
      amountCents: input.amountCents ?? i.amountCents,
      status: 'succeeded',
    };
    this.refunds.set(id, refund);
    return refund;
  }

  // ----- Customers -----

  async createCustomer(input: CreateCustomerInput): Promise<{ externalId: string }> {
    this.seq += 1;
    const id = `cus_stub_${Date.now().toString(36)}${this.seq}`;
    this.customers.set(id, {
      tenantId: input.tenantId,
      name: input.name,
      ...(input.email !== undefined ? { email: input.email } : {}),
    });
    return { externalId: id };
  }

  async createSetupIntent(input: CreateSetupIntentInput): Promise<SetupIntentResult> {
    this.seq += 1;
    const id = `seti_stub_${Date.now().toString(36)}${this.seq}`;
    this.setupIntents.set(id, {
      customer: input.customerExternalId,
      account: input.connectedAccountId,
    });
    return {
      externalId: id,
      clientSecret: `${id}_secret_${randomBytes(4).toString('hex')}`,
      status: 'requires_payment_method',
    };
  }

  async detachPaymentMethod(_input: DetachPaymentMethodInput): Promise<void> {
    // no-op for the stub
  }

  // ----- Webhook signature -----

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookEvent {
    const parts = signature.split(',').reduce<Record<string, string>>((acc, pair) => {
      const [k, v] = pair.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const ts = parts.t;
    const v1 = parts.v1;
    if (!ts || !v1) throw new Error('Invalid stripe signature header');
    // Constant-time compare — mirrors the real Stripe SDK so the stub never
    // teaches a timing side-channel that live mode doesn't have.
    const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(v1, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Stripe signature verification failed');
    }
    const parsed = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      livemode?: boolean;
      account?: string | null;
      data?: { object?: Record<string, unknown> };
    };
    return {
      id: parsed.id ?? `evt_stub_${Date.now()}`,
      type: parsed.type ?? 'unknown',
      livemode: parsed.livemode ?? false,
      account: parsed.account ?? null,
      data: { object: parsed.data?.object ?? {} },
      payload: parsed as Record<string, unknown>,
    };
  }

  /**
   * Test helper: build a Stripe-style header for a payload so tests can hit
   * the webhook endpoint without monkey-patching the signature check.
   */
  static signPayload(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
    const v1 = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    return `t=${ts},v1=${v1}`;
  }
}
