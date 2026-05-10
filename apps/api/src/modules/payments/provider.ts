/**
 * PaymentProvider — Session 11 surface used by the platform to talk to a
 * card processor.
 *
 * Stripe is the first implementation; a future Adyen / Square / NMI provider
 * implements the same contract and is selected at runtime via the
 * IntegrationRegistry. The contract is intentionally small: every method
 * returns plain DTOs and never leaks the underlying SDK's types upward.
 *
 * Connect model (multi-tenant payouts):
 *   The platform holds the API keys; each tenant has a *connected account*
 *   that money is routed to. Every charge is created `on_behalf_of` and
 *   `transfer_data.destination = tenant.stripe_account_id` so the funds
 *   land in the tenant's bank, with the platform retaining its margin.
 *
 * PCI scope:
 *   Card data never touches our servers. Stripe Elements is loaded into
 *   the public /pay/[token] page from Stripe's CDN; we only ever see
 *   payment-method tokens (pm_xxx). This keeps us in SAQ A.
 */

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  vendor: string;
}

export interface CreatePaymentIntentInput {
  /** Stripe Connect destination account (tenant). */
  connectedAccountId: string;
  amountCents: number;
  currency: string;
  /** Tenant's invoice id — flows through to webhook metadata. */
  invoiceId: string;
  tenantId: string;
  description?: string;
  /**
   * If set, the platform fee (in cents) routed to the platform account.
   * Layered on top of Stripe's own processing fees.
   */
  applicationFeeCents?: number;
  /** Stripe customer id when present (used to attach saved payment methods). */
  customerExternalId?: string;
  /** Pre-confirmed off-session charge against a saved card. */
  paymentMethodId?: string;
  offSession?: boolean;
  /** When true, save the collected method to the customer for reuse. */
  setupFutureUsage?: boolean;
  metadata?: Record<string, string>;
}

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'succeeded'
  | 'canceled';

export interface PaymentIntentResult {
  externalId: string;
  status: PaymentIntentStatus;
  amountCents: number;
  currency: string;
  clientSecret: string | null;
  /** When succeeded, the underlying ch_xxx — used for refunds. */
  chargeId: string | null;
  /** Stripe's processing fee, when known (only after balance_transaction settles). */
  feeCents: number | null;
  paymentMethodId: string | null;
}

export interface CapturePaymentInput {
  paymentIntentId: string;
  connectedAccountId: string;
  amountToCaptureCents?: number;
}

export interface ConfirmPaymentInput {
  paymentIntentId: string;
  connectedAccountId: string;
  paymentMethodId?: string;
}

export interface RefundInput {
  /** Either the original payment intent or charge id. */
  paymentIntentId: string;
  connectedAccountId: string;
  amountCents?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'expired_uncaptured_charge';
}

export interface RefundResult {
  externalId: string;
  paymentIntentId: string;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
}

export interface CreateConnectedAccountInput {
  tenantId: string;
  tenantName: string;
  email: string;
  country?: string;
}

export interface ConnectedAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
}

export interface OnboardingLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}

export interface OnboardingLinkResult {
  url: string;
  expiresAt: number;
}

export interface CreateCustomerInput {
  tenantId: string;
  connectedAccountId: string;
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
  metadata?: Record<string, string>;
}

export interface CreateSetupIntentInput {
  connectedAccountId: string;
  customerExternalId: string;
}

export interface SetupIntentResult {
  externalId: string;
  clientSecret: string;
  status: string;
}

export interface DetachPaymentMethodInput {
  connectedAccountId: string;
  paymentMethodId: string;
}

export interface PaymentProvider {
  readonly descriptor: ProviderDescriptor;

  // --- Connect onboarding ---
  createConnectedAccount(input: CreateConnectedAccountInput): Promise<{ accountId: string }>;
  getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus>;
  createOnboardingLink(input: OnboardingLinkInput): Promise<OnboardingLinkResult>;

  // --- payment intents ---
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  confirmPaymentIntent(input: ConfirmPaymentInput): Promise<PaymentIntentResult>;
  capturePayment(input: CapturePaymentInput): Promise<PaymentIntentResult>;
  getPaymentStatus(
    paymentIntentId: string,
    connectedAccountId: string,
  ): Promise<PaymentIntentResult | null>;

  // --- refunds ---
  refund(input: RefundInput): Promise<RefundResult>;

  // --- customers / saved methods ---
  createCustomer(input: CreateCustomerInput): Promise<{ externalId: string }>;
  createSetupIntent(input: CreateSetupIntentInput): Promise<SetupIntentResult>;
  detachPaymentMethod(input: DetachPaymentMethodInput): Promise<void>;

  // --- webhook signature ---
  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookEvent;
}

export interface WebhookEvent {
  id: string;
  type: string;
  livemode: boolean;
  account: string | null;
  data: { object: Record<string, unknown> };
  /** Original payload — useful for replay and tests. */
  payload: Record<string, unknown>;
}
