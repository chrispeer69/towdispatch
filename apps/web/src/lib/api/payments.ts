/**
 * Server-side fetchers for the Stripe payments module. Same pattern as the
 * billing.ts fetchers — `apiServer` keeps the access cookie out of the
 * browser bundle.
 */
import type {
  CardOnFileDto,
  PayLinkDto,
  PaymentIntentDto,
  StripeConnectStatusDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

export async function fetchConnectStatus(): Promise<StripeConnectStatusDto> {
  return apiServer<StripeConnectStatusDto>('/payments/connect/status');
}

export async function startConnectOnboarding(): Promise<{
  accountId: string;
  onboardingUrl: string;
}> {
  return apiServer('/payments/connect/start', { method: 'POST' });
}

export async function refreshConnectLink(): Promise<{ onboardingUrl: string }> {
  return apiServer('/payments/connect/refresh-link', { method: 'POST' });
}

export async function syncConnectAccount(): Promise<StripeConnectStatusDto> {
  return apiServer('/payments/connect/sync', { method: 'POST' });
}

export async function setPlatformMargin(bps: number): Promise<StripeConnectStatusDto> {
  return apiServer('/payments/connect/margin', {
    method: 'PUT',
    body: { platformMarginBps: bps },
  });
}

export async function issuePayLink(invoiceId: string): Promise<PayLinkDto> {
  return apiServer('/payments/pay-link', {
    method: 'POST',
    body: { invoiceId },
  });
}

export async function createInvoicePaymentIntent(
  invoiceId: string,
  chargeCardOnFile = false,
): Promise<PaymentIntentDto> {
  return apiServer('/payments/intents', {
    method: 'POST',
    body: { invoiceId, chargeCardOnFile, savePaymentMethod: false },
  });
}

export async function fetchCardOnFile(customerId: string): Promise<CardOnFileDto> {
  return apiServer<CardOnFileDto>(`/payments/customers/${customerId}/card`);
}
