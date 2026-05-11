/**
 * AccountingProvider — contract for any accounting back-end. QuickBooks Online
 * is the first implementation (Session 12); QuickBooks Desktop, Xero, NetSuite,
 * Sage Intacct, etc. plug in behind the same interface in later sessions.
 *
 * Surface scope:
 *   - Push-side primitives: syncCustomer/Invoice/Payment/Refund. Each receives
 *     the internal entity and returns an external-id mapping. Implementations
 *     are responsible for idempotency (use the supplied externalId hint if the
 *     entity has been synced before, otherwise look up by tenant+entity).
 *   - Pull-side primitives: pullChartOfAccounts so the operator can map
 *     internal billing categories onto the operator's QBO chart.
 *   - OAuth helpers: getAuthorizationUrl + exchangeCode + refreshTokens.
 *   - Webhook signature verification.
 *
 * The orchestrating AccountingService owns the higher-level mapAccount /
 * getSyncStatus / retrySync surface (they involve DB state, not provider
 * state) — exposed to callers via AccountingService and not through this
 * interface, so we keep providers thin.
 */
import type { IntegrationProvider } from '../types.js';

export interface AccountingProviderCredentials {
  /** QBO uses realmId as the company id; other providers may ignore it. */
  realmId?: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  /** True when the credentials target the provider's sandbox surface. */
  sandbox: boolean;
}

export interface AccountingCustomerInput {
  internalId: string;
  externalId?: string | undefined;
  displayName: string;
  email?: string | undefined;
  phone?: string | undefined;
  billingAddress?:
    | {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
      }
    | undefined;
}

export interface AccountingCustomerResult {
  externalId: string;
  /** True when a matching external customer was found (vs created). */
  matchedExisting: boolean;
}

export interface AccountingInvoiceLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  /** Maps to a QBO Item or AccountRef on the provider side. */
  internalCategory?: string;
}

export interface AccountingInvoiceInput {
  internalId: string;
  externalId?: string | undefined;
  customerExternalId: string;
  number: string;
  status: 'draft' | 'issued' | 'sent' | 'partially_paid' | 'paid' | 'void' | 'overdue' | 'refunded';
  issuedAt: string;
  dueAt: string | null;
  totalCents: number;
  taxCents: number;
  currency: string;
  lines: AccountingInvoiceLine[];
  memo?: string;
}

export interface AccountingInvoiceResult {
  externalId: string;
  externalNumber: string;
  externalStatus: string;
}

export interface AccountingPaymentInput {
  internalId: string;
  externalId?: string | undefined;
  customerExternalId: string;
  invoiceExternalId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  method: string;
}

export interface AccountingPaymentResult {
  externalId: string;
}

export interface AccountingRefundInput {
  internalId: string;
  externalId?: string | undefined;
  customerExternalId: string;
  invoiceExternalId: string;
  originalPaymentExternalId: string;
  amountCents: number;
  currency: string;
  refundedAt: string;
}

export interface AccountingRefundResult {
  externalId: string;
}

export interface ChartOfAccount {
  externalId: string;
  name: string;
  /** QBO uses "AccountType" (Income, Expense, Bank, etc.). */
  type: string;
  /** Optional sub-classification. */
  subType?: string;
  active: boolean;
}

export interface AccountingOAuthAuthorizationUrl {
  url: string;
  state: string;
}

export interface AccountingOAuthCodeExchange {
  code: string;
  realmId: string;
  redirectUri: string;
}

export interface AccountingOAuthTokens {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface AccountingWebhookEvent {
  realmId: string;
  /** Entity changes batched in the webhook body. */
  changes: Array<{
    entityName: 'Customer' | 'Invoice' | 'Payment' | 'RefundReceipt' | 'Item' | 'Account';
    entityId: string;
    operation: 'Create' | 'Update' | 'Delete' | 'Merge' | 'Void';
    lastUpdated: string;
  }>;
}

export interface AccountingProvider extends IntegrationProvider {
  // ---- data push ----
  syncCustomer(
    creds: AccountingProviderCredentials,
    customer: AccountingCustomerInput,
  ): Promise<AccountingCustomerResult>;

  syncInvoice(
    creds: AccountingProviderCredentials,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingInvoiceResult>;

  syncPayment(
    creds: AccountingProviderCredentials,
    payment: AccountingPaymentInput,
  ): Promise<AccountingPaymentResult>;

  syncRefund(
    creds: AccountingProviderCredentials,
    refund: AccountingRefundInput,
  ): Promise<AccountingRefundResult>;

  // ---- data pull ----
  pullChartOfAccounts(creds: AccountingProviderCredentials): Promise<ChartOfAccount[]>;

  // ---- OAuth ----
  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    sandbox: boolean;
  }): AccountingOAuthAuthorizationUrl;

  exchangeAuthorizationCode(
    input: AccountingOAuthCodeExchange & { sandbox: boolean },
  ): Promise<AccountingOAuthTokens>;

  refreshTokens(creds: AccountingProviderCredentials): Promise<AccountingOAuthTokens>;

  // ---- webhook ----
  verifyWebhookSignature(rawBody: string, signature: string, verifierToken: string): boolean;
  parseWebhookPayload(rawBody: string): AccountingWebhookEvent[];
}
