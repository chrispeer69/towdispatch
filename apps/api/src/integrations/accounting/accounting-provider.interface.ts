/**
 * AccountingProvider — contract for any accounting back-end (QuickBooks Online
 * first; Xero, Sage, RECON AI later). Implementations live in their own
 * modules and self-register with the IntegrationRegistry.
 *
 * Surface kept intentionally narrow: invoices, customers, payments, and a
 * sync-state probe. Anything richer (line items, taxes, journal entries) can
 * be modeled per-provider behind these primitives without changing callers.
 */
import type { IntegrationProvider } from '../types.js';

export interface AccountingCustomer {
  externalId: string;
  displayName: string;
  email?: string;
  phone?: string;
}

export interface AccountingInvoice {
  externalId: string;
  customerExternalId: string;
  number: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  amountCents: number;
  currency: string;
  issuedAt: string;
  dueAt?: string;
  paidAt?: string;
}

export interface AccountingPayment {
  externalId: string;
  invoiceExternalId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  method?: string;
}

export interface AccountingProviderCredentials {
  /** Opaque per-tenant credential blob; provider validates shape internally. */
  config: Record<string, unknown>;
}

export interface AccountingSyncState {
  lastSyncAt: string | null;
  healthy: boolean;
  message?: string;
}

export interface AccountingProvider extends IntegrationProvider {
  upsertCustomer(
    creds: AccountingProviderCredentials,
    customer: AccountingCustomer,
  ): Promise<AccountingCustomer>;
  createInvoice(
    creds: AccountingProviderCredentials,
    invoice: AccountingInvoice,
  ): Promise<AccountingInvoice>;
  recordPayment(
    creds: AccountingProviderCredentials,
    payment: AccountingPayment,
  ): Promise<AccountingPayment>;
  getInvoice(
    creds: AccountingProviderCredentials,
    externalId: string,
  ): Promise<AccountingInvoice | null>;
  syncState(creds: AccountingProviderCredentials): Promise<AccountingSyncState>;
}
