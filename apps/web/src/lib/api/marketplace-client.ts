/**
 * Browser-side helpers for the public bidder marketplace (Session 33).
 * Hits the same-origin public BFF (/api/auctionpub/*). The bidder session
 * (JWT + bidder DTO) lives in localStorage keyed by tenant slug, since a
 * bidder is scoped to one tenant's marketplace at a time.
 */
'use client';
import type {
  AuctionBidDto,
  AuctionBidderDto,
  BidderAuthResponse,
  BidderLoginPayload,
  BidderRegisterPayload,
  BidderRegisterResponse,
  PublicAuctionListingDto,
} from '@ustowdispatch/shared';

const tokenKey = (slug: string): string => `auction_bidder_token:${slug}`;
const bidderKey = (slug: string): string => `auction_bidder:${slug}`;

export function getBidderToken(slug: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(tokenKey(slug));
}

export function getBidder(slug: string): AuctionBidderDto | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(bidderKey(slug));
  return raw ? (JSON.parse(raw) as AuctionBidderDto) : null;
}

export function setBidderSession(slug: string, session: BidderAuthResponse): void {
  window.localStorage.setItem(tokenKey(slug), session.accessToken);
  window.localStorage.setItem(bidderKey(slug), JSON.stringify(session.bidder));
}

export function clearBidderSession(slug: string): void {
  window.localStorage.removeItem(tokenKey(slug));
  window.localStorage.removeItem(bidderKey(slug));
}

async function call<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/auctionpub/${path}`, { ...init, headers });
 * Browser-side marketplace client (Session 46) — thin wrappers over the
 * operator BFF routes for the Installed Apps screen. Mirrors lien-client.ts.
 */
import type { InstalledAppDto } from '@ustowdispatch/shared';

const BASE = '/api/installed-apps';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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

// ---- bidder auth ----
export const bidderRegister = (body: BidderRegisterPayload) =>
  call<BidderRegisterResponse>('bidder-auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const bidderVerifyEmail = (token: string) =>
  call<BidderAuthResponse>('bidder-auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
export const bidderLogin = (body: BidderLoginPayload) =>
  call<BidderAuthResponse>('bidder-auth/login', { method: 'POST', body: JSON.stringify(body) });

// ---- marketplace ----
export const browseListings = (slug: string) =>
  call<PublicAuctionListingDto[]>(`marketplace/t/${encodeURIComponent(slug)}/listings`);
export const browseListing = (slug: string, id: string) =>
  call<PublicAuctionListingDto>(`marketplace/t/${encodeURIComponent(slug)}/listings/${id}`);
export const placeBid = (slug: string, listingId: string, bidAmountCents: number) =>
  call<AuctionBidDto>(
    `marketplace/listings/${listingId}/bids`,
    { method: 'POST', body: JSON.stringify({ bidAmountCents }) },
    getBidderToken(slug),
  );
export const fetchMyBids = (slug: string) =>
  call<AuctionBidDto[]>('marketplace/my-bids', undefined, getBidderToken(slug));
export const clientListInstalled = (): Promise<InstalledAppDto[]> => req<InstalledAppDto[]>(BASE);

export const clientUninstall = (id: string): Promise<null> =>
  req<null>(`${BASE}/${id}`, { method: 'DELETE' });
