/**
 * Server-side fetchers for the billing module. Same pattern as
 * apps/web/src/lib/api/resources.ts — every function uses `apiServer` so the
 * access cookie stays server-only.
 */
import type {
  AgingResponse,
  CreditMemoDto,
  InvoiceDto,
  InvoiceReviewDto,
  InvoiceWithDetailsDto,
  PaymentDto,
  RecurringScheduleDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

export interface InvoiceListResponse {
  data: InvoiceDto[];
  total: number;
  limit: number;
  offset: number;
}
export interface PaymentListResponse {
  data: PaymentDto[];
  total: number;
}

export async function fetchInvoices(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<InvoiceListResponse> {
  return apiServer<InvoiceListResponse>(`/billing/invoices${toQuery(query)}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchInvoice(id: string): Promise<InvoiceWithDetailsDto> {
  return apiServer<InvoiceWithDetailsDto>(`/billing/invoices/${id}`);
}

export async function fetchInvoiceReview(
  id: string,
  accessToken?: string | null,
): Promise<InvoiceReviewDto> {
  return apiServer<InvoiceReviewDto>(`/billing/invoices/${id}/review`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchPayments(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<PaymentListResponse> {
  return apiServer<PaymentListResponse>(`/billing/payments${toQuery(query)}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchAging(
  query: Record<string, string | undefined>,
  accessToken?: string | null,
): Promise<AgingResponse> {
  return apiServer<AgingResponse>(`/billing/aging${toQuery(query)}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchCreditMemos(accessToken?: string | null): Promise<CreditMemoDto[]> {
  return apiServer<CreditMemoDto[]>('/billing/credit-memos', {
    accessToken: accessToken ?? null,
  });
}

export async function fetchRecurringSchedules(
  accessToken?: string | null,
): Promise<RecurringScheduleDto[]> {
  return apiServer<RecurringScheduleDto[]>('/billing/recurring', {
    accessToken: accessToken ?? null,
  });
}

function toQuery(q: Record<string, string | undefined>): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, v as string);
  return `?${params.toString()}`;
}

export function formatMoneyCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}
