/**
 * Browser-side helpers for /api/capacity/*. Hits the BFF; never imports
 * next/headers. Mirrors dynamic-pricing-client.ts.
 */
import type {
  CapacityBroadcastPage,
  CapacityOverrideDto,
  CapacityPartnerCredentials,
  CapacityPartnerDto,
  CapacitySettingsDto,
  CapacityStatusDto,
  CapacityTestFireResult,
  CreateCapacityOverridePayload,
  CreateCapacityPartnerPayload,
  UpdateCapacityPartnerPayload,
  UpdateCapacitySettingsPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/capacity/${path}`, {
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

export const clientGetCapacityStatus = () => bff<CapacityStatusDto>('status');

export const clientUpdateCapacitySettings = (body: UpdateCapacitySettingsPayload) =>
  bff<CapacitySettingsDto>('settings', { method: 'PATCH', body: JSON.stringify(body) });

export const clientListCapacityOverrides = (history = false) =>
  bff<CapacityOverrideDto[]>(`overrides?history=${history}`);

export const clientCreateCapacityOverride = (body: CreateCapacityOverridePayload) =>
  bff<CapacityOverrideDto>('overrides', { method: 'POST', body: JSON.stringify(body) });

export const clientClearCapacityOverride = (id: string) =>
  bff<void>(`overrides/${id}`, { method: 'DELETE' });

export const clientListCapacityPartners = () => bff<CapacityPartnerDto[]>('partners');

export const clientCreateCapacityPartner = (body: CreateCapacityPartnerPayload) =>
  bff<CapacityPartnerCredentials>('partners', { method: 'POST', body: JSON.stringify(body) });

export const clientUpdateCapacityPartner = (id: string, body: UpdateCapacityPartnerPayload) =>
  bff<CapacityPartnerDto>(`partners/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientDeleteCapacityPartner = (id: string) =>
  bff<void>(`partners/${id}`, { method: 'DELETE' });

export const clientRotateCapacityPartnerSecret = (id: string) =>
  bff<CapacityPartnerCredentials>(`partners/${id}/rotate-secret`, { method: 'POST' });

export const clientRotateCapacityPartnerKey = (id: string) =>
  bff<CapacityPartnerCredentials>(`partners/${id}/rotate-key`, { method: 'POST' });

export const clientTestFireCapacityPartner = (id: string) =>
  bff<CapacityTestFireResult>(`partners/${id}/test-fire`, { method: 'POST' });

export const clientListCapacityBroadcasts = (query: {
  partnerId?: string;
  status?: string;
  page?: number;
  perPage?: number;
}) => {
  const qs = new URLSearchParams();
  if (query.partnerId) qs.set('partnerId', query.partnerId);
  if (query.status) qs.set('status', query.status);
  if (query.page) qs.set('page', String(query.page));
  if (query.perPage) qs.set('perPage', String(query.perPage));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return bff<CapacityBroadcastPage>(`broadcasts${tail}`);
};
