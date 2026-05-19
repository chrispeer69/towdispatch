/**
 * Browser-side helpers for /api/tier-offers/* — hits the BFF; never
 * imports next/headers. Mirrors the dynamic-pricing-client.ts shape.
 */
import type {
  CancelTierOfferPayload,
  CreateTierOfferPayload,
  CreateTierOfferRecipientPayload,
  TierOfferDto,
  TierOfferRecipientDto,
  TierOfferStatus,
  UpdateTierOfferPayload,
  UpdateTierOfferRecipientPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/tier-offers/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (HTTP ${res.status})`);
  }
  if (res.status === 204) return null as unknown as T;
  return (await res.json()) as T;
}

export interface TierOfferListItem extends TierOfferDto {}
export interface TierOfferDetailResponse {
  offer: TierOfferDto;
  recipients: TierOfferRecipientDto[];
}
export interface TierOfferSendResponse {
  offer: TierOfferDto;
  recipients: TierOfferRecipientDto[];
  alreadySent: boolean;
  dispatchedCount: number;
}

export const clientListTierOffers = (status?: TierOfferStatus) =>
  bff<TierOfferListItem[]>(`${status ? `?status=${status}` : ''}`);

export const clientGetTierOffer = (id: string) => bff<TierOfferDetailResponse>(`${id}`);

export const clientCreateTierOffer = (body: CreateTierOfferPayload) =>
  bff<TierOfferDto>('', { method: 'POST', body: JSON.stringify(body) });

export const clientUpdateTierOffer = (id: string, body: UpdateTierOfferPayload) =>
  bff<TierOfferDto>(`${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientDeleteTierOffer = (id: string) => bff<void>(`${id}`, { method: 'DELETE' });

export const clientAddRecipient = (id: string, body: CreateTierOfferRecipientPayload) =>
  bff<TierOfferRecipientDto>(`${id}/recipients`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const clientUpdateRecipient = (
  id: string,
  recipientId: string,
  body: UpdateTierOfferRecipientPayload,
) =>
  bff<TierOfferRecipientDto>(`${id}/recipients/${recipientId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const clientRemoveRecipient = (id: string, recipientId: string) =>
  bff<void>(`${id}/recipients/${recipientId}`, { method: 'DELETE' });

export const clientSendTierOffer = (id: string) =>
  bff<TierOfferSendResponse>(`${id}/send`, { method: 'POST' });

export const clientCancelTierOffer = (id: string, body: CancelTierOfferPayload) =>
  bff<TierOfferDto>(`${id}/cancel`, { method: 'POST', body: JSON.stringify(body) });

export interface ReconciliationRow {
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  accountId: string | null;
  accountName: string | null;
  status: string;
  respondedAt: string | null;
  jobsCompleted: number;
  totalBilledCents: number;
  estimatedStandardCents: number;
  upliftCents: number;
}
export interface ReconciliationReport {
  offerId: string;
  status: string;
  eventWindowStart: string;
  eventWindowEnd: string;
  defaultForNonResponders: string;
  rows: ReconciliationRow[];
  disclaimer: string | null;
}

export const clientGetReconciliation = (id: string) =>
  bff<ReconciliationReport>(`${id}/reconciliation`);
