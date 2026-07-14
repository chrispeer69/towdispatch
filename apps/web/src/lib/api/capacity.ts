import type {
  CapacityBroadcastPage,
  CapacityOverrideDto,
  CapacityPartnerDto,
  CapacitySettingsDto,
  CapacityStatusDto,
} from '@ustowdispatch/shared';
/**
 * Server-side typed fetchers for CADS (Capacity-Aware Dispatch Signaling).
 * Mirrors the dynamic-pricing pattern: every call goes through apiServer
 * so the access cookie stays server-only, and pages pass the token read
 * at the page level (see RequestOpts.accessToken in ./client.ts).
 */
import { apiServer } from './client';

export async function fetchCapacityStatus(token?: string | null): Promise<CapacityStatusDto> {
  return apiServer<CapacityStatusDto>('/capacity/status', {
    accessToken: token ?? null,
  });
}

export async function fetchCapacitySettings(token?: string | null): Promise<CapacitySettingsDto> {
  return apiServer<CapacitySettingsDto>('/capacity/settings', {
    accessToken: token ?? null,
  });
}

export async function fetchCapacityOverrides(
  history = false,
  token?: string | null,
): Promise<CapacityOverrideDto[]> {
  return apiServer<CapacityOverrideDto[]>(`/capacity/overrides?history=${history}`, {
    accessToken: token ?? null,
  });
}

export async function fetchCapacityPartners(token?: string | null): Promise<CapacityPartnerDto[]> {
  return apiServer<CapacityPartnerDto[]>('/capacity/partners', {
    accessToken: token ?? null,
  });
}

export async function fetchCapacityBroadcasts(
  query: { partnerId?: string; status?: string; page?: number; perPage?: number } = {},
  token?: string | null,
): Promise<CapacityBroadcastPage> {
  const qs = new URLSearchParams();
  if (query.partnerId) qs.set('partnerId', query.partnerId);
  if (query.status) qs.set('status', query.status);
  if (query.page) qs.set('page', String(query.page));
  if (query.perPage) qs.set('perPage', String(query.perPage));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiServer<CapacityBroadcastPage>(`/capacity/broadcasts${tail}`, {
    accessToken: token ?? null,
  });
}
