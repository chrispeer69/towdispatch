/**
 * StripePaymentProvider — concrete PaymentProvider backed by the Stripe Node
 * SDK and Stripe Connect (Express accounts).
 *
 * Configuration:
 *   STRIPE_SECRET_KEY          — platform restricted/secret key (sk_test_*, sk_live_*)
 *   STRIPE_PUBLIC_KEY          — publishable key (pk_test_*, pk_live_*)
 *                                exposed to the public /pay/[token] page
 *                                via the public-view endpoint.
 *   STRIPE_WEBHOOK_SECRET      — whsec_* used to verify webhook signatures
 *   STRIPE_API_VERSION         — pinned; default 2024-09-30.acacia
 *
 * When STRIPE_SECRET_KEY is missing or contains the placeholder substring
 * "missing", every method throws a clear error so the dashboard surface tells
 * the operator to configure keys instead of silently failing during a charge.
 */
import Stripe from 'stripe';
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
  id: 'stripe',
  displayName: 'Stripe',
  vendor: 'stripe',
};

export class StripePaymentProvider implements PaymentProvider {
  readonly descriptor = PROVIDER_DESCRIPTOR;
  private readonly client: Stripe;

  constructor(secretKey: string, apiVersion?: Stripe.LatestApiVersion) {
    if (!secretKey || secretKey.includes('missing')) {
      throw new Error(
        'STRIPE_SECRET_KEY not configured — set it in the environment to enable payments.',
      );
    }
    this.client = new Stripe(secretKey, {
      // Cast keeps us pinned to whichever LatestApiVersion the installed SDK
      // ships. We don't hard-pin to a specific date string here — the SDK's
      // typing is too narrow for cross-version compatibility.
      apiVersion: (apiVersion ?? '2024-11-20.acacia') as Stripe.LatestApiVersion,
      typescript: true,
      maxNetworkRetries: 2,
    });
  }

  // ----------------- Connect -----------------

  async createConnectedAccount(input: CreateConnectedAccountInput): Promise<{ accountId: string }> {
    const acct = await this.client.accounts.create({
      type: 'express',
      country: input.country ?? 'US',
      email: input.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: input.tenantName,
      },
      metadata: { tenantId: input.tenantId },
    });
    return { accountId: acct.id };
  }

  async getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
    const acct = await this.client.accounts.retrieve(accountId);
    return {
      accountId: acct.id,
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      detailsSubmitted: !!acct.details_submitted,
      requirementsCurrentlyDue: acct.requirements?.currently_due ?? [],
    };
  }

  async createOnboardingLink(input: OnboardingLinkInput): Promise<OnboardingLinkResult> {
    const link = await this.client.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url, expiresAt: link.expires_at };
  }

  // ----------------- Payment intents -----------------

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      description: input.description,
      metadata: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        ...(input.metadata ?? {}),
      },
      // Stripe Connect: charge on behalf of the connected account but still
      // process via the platform key. The destination charge model means the
      // platform sees the funds momentarily before transfer.
      transfer_data: { destination: input.connectedAccountId },
      on_behalf_of: input.connectedAccountId,
    };
    if (input.applicationFeeCents && input.applicationFeeCents > 0) {
      params.application_fee_amount = input.applicationFeeCents;
    }
    if (input.customerExternalId) params.customer = input.customerExternalId;
    if (input.paymentMethodId) {
      params.payment_method = input.paymentMethodId;
      if (input.offSession) params.off_session = true;
      params.confirm = true;
    }
    if (input.setupFutureUsage) params.setup_future_usage = 'off_session';

    const pi = await this.client.paymentIntents.create(params);
    return mapIntent(pi);
  }

  async confirmPaymentIntent(input: ConfirmPaymentInput): Promise<PaymentIntentResult> {
    const params: Stripe.PaymentIntentConfirmParams = {};
    if (input.paymentMethodId) params.payment_method = input.paymentMethodId;
    const pi = await this.client.paymentIntents.confirm(input.paymentIntentId, params, {
      stripeAccount: input.connectedAccountId,
    });
    return mapIntent(pi);
  }

  async capturePayment(input: CapturePaymentInput): Promise<PaymentIntentResult> {
    const params: Stripe.PaymentIntentCaptureParams = {};
    if (input.amountToCaptureCents !== undefined)
      params.amount_to_capture = input.amountToCaptureCents;
    const pi = await this.client.paymentIntents.capture(input.paymentIntentId, params, {
      stripeAccount: input.connectedAccountId,
    });
    return mapIntent(pi);
  }

  async getPaymentStatus(
    paymentIntentId: string,
    connectedAccountId: string,
  ): Promise<PaymentIntentResult | null> {
    try {
      const pi = await this.client.paymentIntents.retrieve(paymentIntentId, {
        stripeAccount: connectedAccountId,
      });
      return mapIntent(pi);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') {
        return null;
      }
      throw err;
    }
  }

  // ----------------- Refunds -----------------

  async refund(input: RefundInput): Promise<RefundResult> {
    const params: Stripe.RefundCreateParams = {
      payment_intent: input.paymentIntentId,
    };
    if (input.amountCents !== undefined) params.amount = input.amountCents;
    if (input.reason) params.reason = input.reason;
    const r = await this.client.refunds.create(params, {
      stripeAccount: input.connectedAccountId,
    });
    return {
      externalId: r.id,
      paymentIntentId: input.paymentIntentId,
      amountCents: r.amount,
      status: (r.status ?? 'pending') as RefundResult['status'],
    };
  }

  // ----------------- Customers / saved methods -----------------

  async createCustomer(input: CreateCustomerInput): Promise<{ externalId: string }> {
    const c = await this.client.customers.create(
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        metadata: {
          tenantId: input.tenantId,
          ...(input.metadata ?? {}),
        },
      },
      { stripeAccount: input.connectedAccountId },
    );
    return { externalId: c.id };
  }

  async createSetupIntent(input: CreateSetupIntentInput): Promise<SetupIntentResult> {
    const si = await this.client.setupIntents.create(
      {
        customer: input.customerExternalId,
        usage: 'off_session',
      },
      { stripeAccount: input.connectedAccountId },
    );
    return {
      externalId: si.id,
      clientSecret: si.client_secret ?? '',
      status: si.status,
    };
  }

  async detachPaymentMethod(input: DetachPaymentMethodInput): Promise<void> {
    await this.client.paymentMethods.detach(input.paymentMethodId, undefined, {
      stripeAccount: input.connectedAccountId,
    });
  }

  // ----------------- Webhook signature verification -----------------

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookEvent {
    const event = this.client.webhooks.constructEvent(rawBody, signature, secret);
    return mapEvent(event);
  }
}

function mapIntent(pi: Stripe.PaymentIntent): PaymentIntentResult {
  let chargeId: string | null = null;
  let feeCents: number | null = null;
  let paymentMethodId: string | null = null;
  if (typeof pi.latest_charge === 'string') {
    chargeId = pi.latest_charge;
  } else if (pi.latest_charge && typeof pi.latest_charge === 'object') {
    chargeId = pi.latest_charge.id;
    const bt = pi.latest_charge.balance_transaction;
    if (bt && typeof bt === 'object' && 'fee' in bt) {
      feeCents = (bt as Stripe.BalanceTransaction).fee;
    }
  }
  if (typeof pi.payment_method === 'string') paymentMethodId = pi.payment_method;
  else if (pi.payment_method && typeof pi.payment_method === 'object') {
    paymentMethodId = (pi.payment_method as Stripe.PaymentMethod).id;
  }
  return {
    externalId: pi.id,
    status: pi.status as PaymentIntentStatus,
    amountCents: pi.amount,
    currency: pi.currency.toUpperCase(),
    clientSecret: pi.client_secret ?? null,
    chargeId,
    feeCents,
    paymentMethodId,
  };
}

function mapEvent(ev: Stripe.Event): WebhookEvent {
  return {
    id: ev.id,
    type: ev.type,
    livemode: ev.livemode,
    account: ev.account ?? null,
    data: { object: ev.data.object as unknown as Record<string, unknown> },
    payload: ev as unknown as Record<string, unknown>,
  };
}
