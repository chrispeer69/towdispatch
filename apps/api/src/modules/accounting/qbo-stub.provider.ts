/**
 * QboStubProvider — in-memory implementation of the AccountingProvider
 * contract used in dev when QBO_CLIENT_ID is missing, and as the default in
 * tests.
 *
 * Behavior:
 *   - syncCustomer/Invoice/Payment/Refund are deterministic upserts keyed on
 *     externalId (when supplied) or internalId (when not). Returned ids look
 *     like `qbc_stub_<n>` / `qbi_stub_<n>` / `qbp_stub_<n>` / `qbr_stub_<n>`.
 *   - pullChartOfAccounts returns a fixed set of typical small-business
 *     accounts (Revenue, Bank, Tax Payable, Discounts, etc.) so the operator
 *     can exercise the mapping UI in dev.
 *   - OAuth: getAuthorizationUrl returns a fake URL with the requested state;
 *     exchangeAuthorizationCode returns deterministic tokens encoding the
 *     supplied code so tests can assert what was exchanged.
 *   - verifyWebhookSignature performs the same HMAC-SHA256 check as the live
 *     provider does, so tests exercise the real verification path.
 *
 * Tests can reach into the public `customers`, `invoices`, `payments`,
 * `refunds`, and `oauthExchanges` maps to assert what was synced.
 */
import { createHmac } from 'node:crypto';
import type {
  AccountingCustomerInput,
  AccountingCustomerResult,
  AccountingInvoiceInput,
  AccountingInvoiceResult,
  AccountingOAuthAuthorizationUrl,
  AccountingOAuthCodeExchange,
  AccountingOAuthTokens,
  AccountingPaymentInput,
  AccountingPaymentResult,
  AccountingProvider,
  AccountingProviderCredentials,
  AccountingRefundInput,
  AccountingRefundResult,
  AccountingWebhookEvent,
  ChartOfAccount,
} from '../../integrations/accounting/accounting-provider.interface.js';
import type { ProviderDescriptor } from '../../integrations/types.js';
import { type DedupCandidate, findDuplicate } from './customer-dedup.js';

const PROVIDER_DESCRIPTOR: ProviderDescriptor = {
  id: 'quickbooks-online-stub',
  displayName: 'QuickBooks Online (stub)',
  vendor: 'quickbooks',
  capabilities: [
    'sync.push.customer',
    'sync.push.invoice',
    'sync.push.payment',
    'sync.push.refund',
  ],
};

interface StubCustomer {
  externalId: string;
  internalId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

interface StubInvoice {
  externalId: string;
  internalId: string;
  customerExternalId: string;
  number: string;
  status: string;
  totalCents: number;
  taxCents: number;
}

interface StubPayment {
  externalId: string;
  internalId: string;
  invoiceExternalId: string;
  amountCents: number;
}

interface StubRefund {
  externalId: string;
  internalId: string;
  originalPaymentExternalId: string;
  amountCents: number;
}

const DEFAULT_CHART: ChartOfAccount[] = [
  { externalId: 'acct-100', name: 'Service Revenue', type: 'Income', active: true },
  { externalId: 'acct-101', name: 'Mileage Revenue', type: 'Income', active: true },
  { externalId: 'acct-102', name: 'Storage Revenue', type: 'Income', active: true },
  { externalId: 'acct-103', name: 'Wait Time Revenue', type: 'Income', active: true },
  { externalId: 'acct-104', name: 'Recovery Revenue', type: 'Income', active: true },
  { externalId: 'acct-105', name: 'Admin Fee Revenue', type: 'Income', active: true },
  {
    externalId: 'acct-200',
    name: 'Sales Tax Payable',
    type: 'Other Current Liability',
    active: true,
  },
  { externalId: 'acct-300', name: 'Bank Operating', type: 'Bank', active: true },
  { externalId: 'acct-301', name: 'Undeposited Funds', type: 'Other Current Asset', active: true },
  {
    externalId: 'acct-302',
    name: 'Accounts Receivable',
    type: 'Accounts Receivable',
    active: true,
  },
  { externalId: 'acct-400', name: 'Stripe Processing Fees', type: 'Expense', active: true },
  { externalId: 'acct-401', name: 'Platform Fees', type: 'Expense', active: true },
  { externalId: 'acct-500', name: 'Discounts Given', type: 'Income', active: true },
  { externalId: 'acct-600', name: 'Refunds', type: 'Expense', active: true },
];

export class QboStubProvider implements AccountingProvider {
  readonly descriptor = PROVIDER_DESCRIPTOR;

  readonly customers = new Map<string, StubCustomer>();
  readonly invoices = new Map<string, StubInvoice>();
  readonly payments = new Map<string, StubPayment>();
  readonly refunds = new Map<string, StubRefund>();
  readonly oauthExchanges: Array<{ code: string; realmId: string; sandbox: boolean }> = [];

  private seq = 0;
  private chart: ChartOfAccount[] = [...DEFAULT_CHART];

  /**
   * Test helper — override the chart returned by pullChartOfAccounts without
   * touching the default which other tests may rely on.
   */
  setChart(accounts: ChartOfAccount[]): void {
    this.chart = [...accounts];
  }

  // ===== Data push =====

  async syncCustomer(
    _creds: AccountingProviderCredentials,
    customer: AccountingCustomerInput,
  ): Promise<AccountingCustomerResult> {
    if (customer.externalId) {
      const existing = this.customers.get(customer.externalId);
      if (existing) {
        existing.displayName = customer.displayName;
        existing.email = customer.email ?? null;
        existing.phone = customer.phone ?? null;
        return { externalId: existing.externalId, matchedExisting: true };
      }
    }
    const candidates: DedupCandidate[] = Array.from(this.customers.values()).map((c) => ({
      externalId: c.externalId,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
    }));
    const dup = findDuplicate(
      {
        displayName: customer.displayName,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
      },
      candidates,
    );
    if (dup) {
      const existing = this.customers.get(dup.externalId);
      if (existing) {
        return { externalId: existing.externalId, matchedExisting: true };
      }
    }
    this.seq += 1;
    const externalId = `qbc_stub_${this.seq}_${customer.internalId.slice(0, 8)}`;
    this.customers.set(externalId, {
      externalId,
      internalId: customer.internalId,
      displayName: customer.displayName,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
    });
    return { externalId, matchedExisting: false };
  }

  async syncInvoice(
    _creds: AccountingProviderCredentials,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingInvoiceResult> {
    if (invoice.externalId) {
      const existing = this.invoices.get(invoice.externalId);
      if (existing) {
        existing.number = invoice.number;
        existing.status = invoice.status;
        existing.totalCents = invoice.totalCents;
        existing.taxCents = invoice.taxCents;
        return {
          externalId: existing.externalId,
          externalNumber: existing.number,
          externalStatus: existing.status,
        };
      }
    }
    this.seq += 1;
    const externalId = `qbi_stub_${this.seq}_${invoice.internalId.slice(0, 8)}`;
    this.invoices.set(externalId, {
      externalId,
      internalId: invoice.internalId,
      customerExternalId: invoice.customerExternalId,
      number: invoice.number,
      status: invoice.status,
      totalCents: invoice.totalCents,
      taxCents: invoice.taxCents,
    });
    return { externalId, externalNumber: invoice.number, externalStatus: invoice.status };
  }

  async syncPayment(
    _creds: AccountingProviderCredentials,
    payment: AccountingPaymentInput,
  ): Promise<AccountingPaymentResult> {
    if (payment.externalId) {
      const existing = this.payments.get(payment.externalId);
      if (existing) {
        existing.amountCents = payment.amountCents;
        return { externalId: existing.externalId };
      }
    }
    this.seq += 1;
    const externalId = `qbp_stub_${this.seq}_${payment.internalId.slice(0, 8)}`;
    this.payments.set(externalId, {
      externalId,
      internalId: payment.internalId,
      invoiceExternalId: payment.invoiceExternalId,
      amountCents: payment.amountCents,
    });
    return { externalId };
  }

  async syncRefund(
    _creds: AccountingProviderCredentials,
    refund: AccountingRefundInput,
  ): Promise<AccountingRefundResult> {
    if (refund.externalId) {
      const existing = this.refunds.get(refund.externalId);
      if (existing) {
        existing.amountCents = refund.amountCents;
        return { externalId: existing.externalId };
      }
    }
    this.seq += 1;
    const externalId = `qbr_stub_${this.seq}_${refund.internalId.slice(0, 8)}`;
    this.refunds.set(externalId, {
      externalId,
      internalId: refund.internalId,
      originalPaymentExternalId: refund.originalPaymentExternalId,
      amountCents: refund.amountCents,
    });
    return { externalId };
  }

  // ===== Data pull =====

  async pullChartOfAccounts(_creds: AccountingProviderCredentials): Promise<ChartOfAccount[]> {
    return this.chart.map((a) => ({ ...a }));
  }

  // ===== OAuth =====

  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    sandbox: boolean;
  }): AccountingOAuthAuthorizationUrl {
    const base = input.sandbox
      ? 'https://appcenter.intuit.test/connect/oauth2/sandbox'
      : 'https://appcenter.intuit.test/connect/oauth2';
    const url = `${base}?state=${encodeURIComponent(input.state)}&redirect_uri=${encodeURIComponent(input.redirectUri)}`;
    return { url, state: input.state };
  }

  async exchangeAuthorizationCode(
    input: AccountingOAuthCodeExchange & { sandbox: boolean },
  ): Promise<AccountingOAuthTokens> {
    this.oauthExchanges.push({
      code: input.code,
      realmId: input.realmId,
      sandbox: input.sandbox,
    });
    const now = Math.floor(Date.now() / 1000);
    return {
      realmId: input.realmId,
      accessToken: `stub_access_${input.code}`,
      refreshToken: `stub_refresh_${input.code}`,
      accessTokenExpiresAt: now + 3600,
      refreshTokenExpiresAt: now + 86_400 * 100,
    };
  }

  async refreshTokens(creds: AccountingProviderCredentials): Promise<AccountingOAuthTokens> {
    const now = Math.floor(Date.now() / 1000);
    return {
      realmId: creds.realmId ?? 'realm_stub',
      accessToken: `stub_access_rotated_${now}`,
      refreshToken: `stub_refresh_rotated_${now}`,
      accessTokenExpiresAt: now + 3600,
      refreshTokenExpiresAt: now + 86_400 * 100,
    };
  }

  // ===== Webhook =====

  verifyWebhookSignature(rawBody: string, signature: string, verifierToken: string): boolean {
    const expected = createHmac('sha256', verifierToken).update(rawBody).digest('base64');
    return safeEqual(expected, signature);
  }

  parseWebhookPayload(rawBody: string): AccountingWebhookEvent[] {
    const parsed = JSON.parse(rawBody) as {
      eventNotifications?: Array<{
        realmId: string;
        dataChangeEvent?: {
          entities?: Array<{
            name: string;
            id: string;
            operation: string;
            lastUpdated: string;
          }>;
        };
      }>;
    };
    return (parsed.eventNotifications ?? []).map((n) => ({
      realmId: n.realmId,
      changes: (n.dataChangeEvent?.entities ?? []).map((e) => ({
        entityName: e.name as AccountingWebhookEvent['changes'][number]['entityName'],
        entityId: e.id,
        operation: e.operation as AccountingWebhookEvent['changes'][number]['operation'],
        lastUpdated: e.lastUpdated,
      })),
    }));
  }

  /** Test helper — produce a Intuit-style HMAC signature for a body. */
  static signPayload(rawBody: string, verifierToken: string): string {
    return createHmac('sha256', verifierToken).update(rawBody).digest('base64');
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}
