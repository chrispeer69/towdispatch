/**
 * QboProvider — Intuit QuickBooks Online live implementation.
 *
 * What this class is and is not:
 *   - It is the network adapter that translates AccountingProvider calls
 *     into Intuit's OAuth 2.0 + REST APIs.
 *   - It is not the sync orchestrator. Retry/backoff/idempotency live in
 *     SyncEngineService; this class is a thin HTTP client.
 *
 * Configuration:
 *   - clientId/secret + redirectUri from ConfigService.quickbooks. When
 *     `QBO_SANDBOX=true` the sandbox base URLs are used; production endpoints
 *     otherwise. AppCenter is the OAuth front door; quickbooks.api.intuit.com
 *     (or sandbox-) is the data API; oauth.platform.intuit.com handles token
 *     exchange.
 *
 * Token freshness:
 *   - Each call to a data API takes a creds blob; if the access token has
 *     less than 60s of life remaining the caller is expected to call
 *     refreshTokens() first (the AccountingService owns that lifecycle so the
 *     refresh-token rotation is durably persisted under tenant scope).
 *
 * Customer dedup is delegated to ../customer-dedup.ts which is shared with the
 * stub provider; both implementations call findDuplicate() over the operator's
 * existing customer list before issuing a Create.
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
  id: 'quickbooks-online',
  displayName: 'QuickBooks Online',
  vendor: 'quickbooks',
  capabilities: [
    'sync.push.customer',
    'sync.push.invoice',
    'sync.push.payment',
    'sync.push.refund',
    'sync.pull.chart_of_accounts',
    'webhook.receive',
  ],
};

const APPCENTER_BASE = 'https://appcenter.intuit.com';
const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE_PROD = 'https://quickbooks.api.intuit.com/v3/company';
const API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const SCOPE = 'com.intuit.quickbooks.accounting';

interface QboProviderOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

interface QboCustomerResponse {
  Customer?: {
    Id: string;
    DisplayName: string;
    PrimaryEmailAddr?: { Address?: string };
    PrimaryPhone?: { FreeFormNumber?: string };
  };
  QueryResponse?: {
    Customer?: Array<{
      Id: string;
      DisplayName: string;
      PrimaryEmailAddr?: { Address?: string };
      PrimaryPhone?: { FreeFormNumber?: string };
    }>;
  };
}

interface QboInvoiceResponse {
  Invoice?: {
    Id: string;
    DocNumber?: string;
  };
}

interface QboPaymentResponse {
  Payment?: { Id: string };
}

interface QboRefundResponse {
  RefundReceipt?: { Id: string };
}

interface QboAccountsResponse {
  QueryResponse?: {
    Account?: Array<{
      Id: string;
      Name: string;
      AccountType: string;
      AccountSubType?: string;
      Active: boolean;
    }>;
  };
}

interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

export class QboProvider implements AccountingProvider {
  readonly descriptor = PROVIDER_DESCRIPTOR;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QboProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // ===== OAuth =====

  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    sandbox: boolean;
  }): AccountingOAuthAuthorizationUrl {
    const params = new URLSearchParams({
      client_id: this.opts.clientId,
      response_type: 'code',
      scope: SCOPE,
      redirect_uri: input.redirectUri,
      state: input.state,
    });
    return {
      url: `${APPCENTER_BASE}/connect/oauth2?${params.toString()}`,
      state: input.state,
    };
  }

  async exchangeAuthorizationCode(
    input: AccountingOAuthCodeExchange & { sandbox: boolean },
  ): Promise<AccountingOAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const json = await this.tokenRequest(body);
    const now = Math.floor(Date.now() / 1000);
    return {
      realmId: input.realmId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      accessTokenExpiresAt: now + json.expires_in,
      refreshTokenExpiresAt: now + json.x_refresh_token_expires_in,
    };
  }

  async refreshTokens(creds: AccountingProviderCredentials): Promise<AccountingOAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    });
    const json = await this.tokenRequest(body);
    const now = Math.floor(Date.now() / 1000);
    return {
      realmId: creds.realmId ?? '',
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      accessTokenExpiresAt: now + json.expires_in,
      refreshTokenExpiresAt: now + json.x_refresh_token_expires_in,
    };
  }

  // ===== Data push =====

  async syncCustomer(
    creds: AccountingProviderCredentials,
    customer: AccountingCustomerInput,
  ): Promise<AccountingCustomerResult> {
    const realmId = this.requireRealm(creds);
    const apiBase = this.apiBaseFor(creds);

    if (customer.externalId) {
      const updated = await this.qboPost<QboCustomerResponse>(
        creds,
        `${apiBase}/${realmId}/customer`,
        {
          Id: customer.externalId,
          SyncToken: '0',
          sparse: true,
          DisplayName: customer.displayName,
          ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
          ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
        },
      );
      const id = updated.Customer?.Id ?? customer.externalId;
      return { externalId: id, matchedExisting: true };
    }

    // Pre-fetch a small candidate set by name/email/phone to feed the dedup
    // rules. Sample size capped at 50 to keep the query bounded.
    const queryClauses: string[] = [`DisplayName = '${escapeSoql(customer.displayName)}'`];
    if (customer.email) queryClauses.push(`PrimaryEmailAddr = '${escapeSoql(customer.email)}'`);
    const soql = `select * from Customer where ${queryClauses.join(' or ')} maxresults 50`;
    const queried = await this.qboGet<QboCustomerResponse>(
      creds,
      `${apiBase}/${realmId}/query?query=${encodeURIComponent(soql)}`,
    );
    const candidates: DedupCandidate[] = (queried.QueryResponse?.Customer ?? []).map((c) => ({
      externalId: c.Id,
      displayName: c.DisplayName,
      email: c.PrimaryEmailAddr?.Address ?? null,
      phone: c.PrimaryPhone?.FreeFormNumber ?? null,
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
      return { externalId: dup.externalId, matchedExisting: true };
    }

    const created = await this.qboPost<QboCustomerResponse>(
      creds,
      `${apiBase}/${realmId}/customer`,
      {
        DisplayName: customer.displayName,
        ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
        ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
      },
    );
    const id = created.Customer?.Id;
    if (!id) throw new Error('QBO did not return a Customer Id');
    return { externalId: id, matchedExisting: false };
  }

  async syncInvoice(
    creds: AccountingProviderCredentials,
    invoice: AccountingInvoiceInput,
  ): Promise<AccountingInvoiceResult> {
    const realmId = this.requireRealm(creds);
    const apiBase = this.apiBaseFor(creds);

    const lines = invoice.lines.map((l, i) => ({
      Id: `${i + 1}`,
      DetailType: 'SalesItemLineDetail',
      Amount: l.amountCents / 100,
      Description: l.description,
      SalesItemLineDetail: {
        Qty: l.quantity,
        UnitPrice: l.unitPriceCents / 100,
      },
    }));

    const body: Record<string, unknown> = {
      DocNumber: invoice.number,
      CustomerRef: { value: invoice.customerExternalId },
      Line: lines,
      TxnDate: invoice.issuedAt.slice(0, 10),
      ...(invoice.dueAt ? { DueDate: invoice.dueAt.slice(0, 10) } : {}),
      ...(invoice.memo ? { CustomerMemo: { value: invoice.memo } } : {}),
    };

    if (invoice.externalId) {
      body.Id = invoice.externalId;
      body.SyncToken = '0';
      body.sparse = true;
    }

    const result = await this.qboPost<QboInvoiceResponse>(
      creds,
      `${apiBase}/${realmId}/invoice`,
      body,
    );
    const id = result.Invoice?.Id ?? invoice.externalId ?? '';
    if (!id) throw new Error('QBO did not return an Invoice Id');
    return {
      externalId: id,
      externalNumber: result.Invoice?.DocNumber ?? invoice.number,
      externalStatus: invoice.status,
    };
  }

  async syncPayment(
    creds: AccountingProviderCredentials,
    payment: AccountingPaymentInput,
  ): Promise<AccountingPaymentResult> {
    const realmId = this.requireRealm(creds);
    const apiBase = this.apiBaseFor(creds);
    const body: Record<string, unknown> = {
      CustomerRef: { value: payment.customerExternalId },
      TotalAmt: payment.amountCents / 100,
      TxnDate: payment.paidAt.slice(0, 10),
      Line: [
        {
          Amount: payment.amountCents / 100,
          LinkedTxn: [{ TxnId: payment.invoiceExternalId, TxnType: 'Invoice' }],
        },
      ],
    };
    if (payment.externalId) {
      body.Id = payment.externalId;
      body.SyncToken = '0';
      body.sparse = true;
    }
    const result = await this.qboPost<QboPaymentResponse>(
      creds,
      `${apiBase}/${realmId}/payment`,
      body,
    );
    const id = result.Payment?.Id ?? payment.externalId ?? '';
    if (!id) throw new Error('QBO did not return a Payment Id');
    return { externalId: id };
  }

  async syncRefund(
    creds: AccountingProviderCredentials,
    refund: AccountingRefundInput,
  ): Promise<AccountingRefundResult> {
    const realmId = this.requireRealm(creds);
    const apiBase = this.apiBaseFor(creds);
    const body: Record<string, unknown> = {
      CustomerRef: { value: refund.customerExternalId },
      TotalAmt: refund.amountCents / 100,
      TxnDate: refund.refundedAt.slice(0, 10),
    };
    if (refund.externalId) {
      body.Id = refund.externalId;
      body.SyncToken = '0';
      body.sparse = true;
    }
    const result = await this.qboPost<QboRefundResponse>(
      creds,
      `${apiBase}/${realmId}/refundreceipt`,
      body,
    );
    const id = result.RefundReceipt?.Id ?? refund.externalId ?? '';
    if (!id) throw new Error('QBO did not return a RefundReceipt Id');
    return { externalId: id };
  }

  // ===== Data pull =====

  async pullChartOfAccounts(creds: AccountingProviderCredentials): Promise<ChartOfAccount[]> {
    const realmId = this.requireRealm(creds);
    const apiBase = this.apiBaseFor(creds);
    const soql = 'select * from Account maxresults 1000';
    const res = await this.qboGet<QboAccountsResponse>(
      creds,
      `${apiBase}/${realmId}/query?query=${encodeURIComponent(soql)}`,
    );
    return (res.QueryResponse?.Account ?? []).map((a) => ({
      externalId: a.Id,
      name: a.Name,
      type: a.AccountType,
      ...(a.AccountSubType ? { subType: a.AccountSubType } : {}),
      active: a.Active,
    }));
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

  // ===== internals =====

  private apiBaseFor(creds: AccountingProviderCredentials): string {
    return creds.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
  }

  private requireRealm(creds: AccountingProviderCredentials): string {
    if (!creds.realmId) throw new Error('QboProvider: missing realmId on credentials');
    return creds.realmId;
  }

  private async tokenRequest(body: URLSearchParams): Promise<QboTokenResponse> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QBO token request failed: ${res.status} ${text}`);
    }
    return (await res.json()) as QboTokenResponse;
  }

  private async qboGet<T>(creds: AccountingProviderCredentials, url: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QBO GET ${url} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  private async qboPost<T>(
    creds: AccountingProviderCredentials,
    url: string,
    body: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QBO POST ${url} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
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

function escapeSoql(v: string): string {
  return v.replace(/'/g, "\\'");
}
