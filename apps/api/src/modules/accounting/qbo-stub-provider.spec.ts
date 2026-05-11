/**
 * Unit coverage for the QboStubProvider — keeps the stub honest about the
 * AccountingProvider contract and locks in the HMAC layout the integration
 * spec uses for webhook delivery.
 */
import { describe, expect, it } from 'vitest';
import type { AccountingProviderCredentials } from '../../integrations/accounting/accounting-provider.interface.js';
import { QboStubProvider } from './qbo-stub.provider.js';

const baseCreds = (): AccountingProviderCredentials => ({
  realmId: 'realm_stub',
  accessToken: 'at_stub',
  refreshToken: 'rt_stub',
  accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86_400,
  sandbox: true,
});

describe('QboStubProvider', () => {
  it('descriptor identifies the stub provider', () => {
    const p = new QboStubProvider();
    expect(p.descriptor.id).toBe('quickbooks-online-stub');
    expect(p.descriptor.vendor).toBe('quickbooks');
  });

  it('syncCustomer creates a new external row with a stub id', async () => {
    const p = new QboStubProvider();
    const r = await p.syncCustomer(baseCreds(), {
      internalId: '00000000-0000-0000-0000-000000000001',
      displayName: 'Alice Hauler',
      email: 'alice@example.com',
      phone: '555-0100',
    });
    expect(r.matchedExisting).toBe(false);
    expect(r.externalId).toMatch(/^qbc_stub_/);
    expect(p.customers.size).toBe(1);
  });

  it('syncCustomer dedups by email on the second call', async () => {
    const p = new QboStubProvider();
    const a = await p.syncCustomer(baseCreds(), {
      internalId: '00000000-0000-0000-0000-000000000001',
      displayName: 'Alice Hauler',
      email: 'alice@example.com',
      phone: '555-0100',
    });
    const b = await p.syncCustomer(baseCreds(), {
      internalId: '00000000-0000-0000-0000-000000000002',
      displayName: 'Alice Hauler Inc',
      email: 'alice@example.com',
      phone: null as unknown as undefined,
    });
    expect(b.externalId).toBe(a.externalId);
    expect(b.matchedExisting).toBe(true);
    expect(p.customers.size).toBe(1);
  });

  it('syncInvoice creates a new external invoice and is idempotent on the same externalId', async () => {
    const p = new QboStubProvider();
    const a = await p.syncInvoice(baseCreds(), {
      internalId: '00000000-0000-0000-0000-000000000010',
      customerExternalId: 'qbc_x',
      number: 'INV-1',
      status: 'issued',
      issuedAt: '2026-05-10T00:00:00Z',
      dueAt: null,
      totalCents: 12_500,
      taxCents: 0,
      currency: 'USD',
      lines: [
        {
          description: 'Tow',
          quantity: 1,
          unitPriceCents: 12_500,
          amountCents: 12_500,
          internalCategory: 'service',
        },
      ],
    });
    const b = await p.syncInvoice(baseCreds(), {
      internalId: '00000000-0000-0000-0000-000000000010',
      externalId: a.externalId,
      customerExternalId: 'qbc_x',
      number: 'INV-1',
      status: 'paid',
      issuedAt: '2026-05-10T00:00:00Z',
      dueAt: null,
      totalCents: 12_500,
      taxCents: 0,
      currency: 'USD',
      lines: [],
    });
    expect(b.externalId).toBe(a.externalId);
    expect(b.externalStatus).toBe('paid');
    expect(p.invoices.size).toBe(1);
  });

  it('syncPayment + syncRefund populate their maps', async () => {
    const p = new QboStubProvider();
    const pay = await p.syncPayment(baseCreds(), {
      internalId: 'p1',
      customerExternalId: 'qbc_x',
      invoiceExternalId: 'qbi_x',
      amountCents: 10_000,
      currency: 'USD',
      paidAt: '2026-05-10T00:00:00Z',
      method: 'credit_card',
    });
    expect(pay.externalId).toMatch(/^qbp_stub_/);
    const ref = await p.syncRefund(baseCreds(), {
      internalId: 'r1',
      customerExternalId: 'qbc_x',
      invoiceExternalId: 'qbi_x',
      originalPaymentExternalId: pay.externalId,
      amountCents: 4_000,
      currency: 'USD',
      refundedAt: '2026-05-10T00:00:00Z',
    });
    expect(ref.externalId).toMatch(/^qbr_stub_/);
    expect(p.payments.size).toBe(1);
    expect(p.refunds.size).toBe(1);
  });

  it('pullChartOfAccounts returns the canned chart', async () => {
    const p = new QboStubProvider();
    const accounts = await p.pullChartOfAccounts(baseCreds());
    expect(accounts.length).toBeGreaterThan(5);
    expect(accounts.find((a) => a.name === 'Service Revenue')).toBeTruthy();
  });

  it('getAuthorizationUrl + exchangeAuthorizationCode + refreshTokens roundtrip', async () => {
    const p = new QboStubProvider();
    const url = p.getAuthorizationUrl({
      state: 'state-abc',
      redirectUri: 'http://test/callback',
      sandbox: true,
    });
    expect(url.url).toContain('state-abc');
    expect(url.url).toContain('sandbox');
    const tokens = await p.exchangeAuthorizationCode({
      code: 'auth-code-1',
      realmId: 'realm-1',
      redirectUri: 'http://test/callback',
      sandbox: true,
    });
    expect(tokens.accessToken).toBe('stub_access_auth-code-1');
    expect(p.oauthExchanges).toHaveLength(1);
    const refreshed = await p.refreshTokens({
      realmId: 'realm-1',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: 0,
      refreshTokenExpiresAt: 0,
      sandbox: true,
    });
    expect(refreshed.accessToken).toMatch(/^stub_access_rotated_/);
  });

  it('verifyWebhookSignature accepts a valid HMAC and rejects a tampered body', () => {
    const p = new QboStubProvider();
    const body = JSON.stringify({
      eventNotifications: [{ realmId: 'r1', dataChangeEvent: { entities: [] } }],
    });
    const sig = QboStubProvider.signPayload(body, 'verifier-x');
    expect(p.verifyWebhookSignature(body, sig, 'verifier-x')).toBe(true);
    expect(p.verifyWebhookSignature(`${body}X`, sig, 'verifier-x')).toBe(false);
  });

  it('parseWebhookPayload unpacks Intuit-style entity changes', () => {
    const p = new QboStubProvider();
    const body = JSON.stringify({
      eventNotifications: [
        {
          realmId: 'r1',
          dataChangeEvent: {
            entities: [
              {
                name: 'Invoice',
                id: '101',
                operation: 'Update',
                lastUpdated: '2026-05-10T00:00:00Z',
              },
              {
                name: 'Payment',
                id: '202',
                operation: 'Create',
                lastUpdated: '2026-05-10T00:00:00Z',
              },
            ],
          },
        },
      ],
    });
    const events = p.parseWebhookPayload(body);
    expect(events).toHaveLength(1);
    expect(events[0]?.changes).toHaveLength(2);
    expect(events[0]?.changes[0]?.entityName).toBe('Invoice');
  });
});
