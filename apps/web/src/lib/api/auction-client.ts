/**
 * Browser-side helpers for /api/auction/* (operator side) — hits the BFF;
 * never imports next/headers. Mirrors impound-client.ts.
 */
import type {
  AuctionEligibleVehicleDto,
  AuctionListingDetailDto,
  AuctionListingDto,
  AwardAuctionListingPayload,
  CreateAuctionListingPayload,
  ListAuctionListingsFilter,
  PublishAuctionListingPayload,
  UpdateAuctionListingPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auction/${path}`, {
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

export function clientListListings(
  filter: ListAuctionListingsFilter = {},
): Promise<AuctionListingDto[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set('status', filter.status);
  if (filter.from) qs.set('from', filter.from);
  if (filter.to) qs.set('to', filter.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return bff<AuctionListingDto[]>(`listings${suffix}`);
}

export const clientGetListing = (id: string) => bff<AuctionListingDetailDto>(`listings/${id}`);
export const clientEligibleVehicles = () => bff<AuctionEligibleVehicleDto[]>('eligible-vehicles');
export const clientCreateListing = (body: CreateAuctionListingPayload) =>
  bff<AuctionListingDto>('listings', { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateListing = (id: string, body: UpdateAuctionListingPayload) =>
  bff<AuctionListingDto>(`listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientPublishListing = (id: string, body: PublishAuctionListingPayload) =>
  bff<AuctionListingDto>(`listings/${id}/publish`, { method: 'POST', body: JSON.stringify(body) });
export const clientWithdrawListing = (id: string) =>
  bff<AuctionListingDto>(`listings/${id}/withdraw`, { method: 'POST', body: JSON.stringify({}) });
export const clientEndListing = (id: string) =>
  bff<AuctionListingDto>(`listings/${id}/end`, { method: 'POST', body: JSON.stringify({}) });
export const clientAwardListing = (id: string, body: AwardAuctionListingPayload) =>
  bff<AuctionListingDto>(`listings/${id}/award`, { method: 'POST', body: JSON.stringify(body) });
