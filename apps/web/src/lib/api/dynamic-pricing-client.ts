/**
 * Browser-side helpers for /api/dynamic-pricing/*. Hits the BFF; never
 * imports next/headers.
 */
import type {
  ApproveDemandSurgeSuggestionPayload,
  CreateDynamicPricingHolidayPayload,
  CreateDynamicPricingNoaaMappingPayload,
  CreateDynamicPricingOverridePayload,
  CreateDynamicPricingTierPayload,
  DeclineQuotePayload,
  DynamicPricingTenantSettings,
  DynamicPricingTierDto,
  SaveStepResponsePayload,
  UpdateDynamicPricingHolidayPayload,
  UpdateDynamicPricingNoaaMappingPayload,
  UpdateDynamicPricingTierPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/dynamic-pricing/${path}`, {
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

export const clientCreateTier = (body: CreateDynamicPricingTierPayload) =>
  bff<DynamicPricingTierDto>('tiers', { method: 'POST', body: JSON.stringify(body) });

export const clientUpdateTier = (id: string, body: UpdateDynamicPricingTierPayload) =>
  bff<DynamicPricingTierDto>(`tiers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientDeleteTier = (id: string) =>
  bff<void>(`tiers/${id}`, { method: 'DELETE' });

export const clientActivateTier = (id: string, reason?: string) =>
  bff<DynamicPricingTierDto>(`tiers/${id}/activate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const clientDeactivateTier = (id: string, reason?: string) =>
  bff<DynamicPricingTierDto>(`tiers/${id}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const clientCreateOverride = (
  jobId: string,
  body: CreateDynamicPricingOverridePayload,
) => bff(`overrides/${jobId}`, { method: 'POST', body: JSON.stringify(body) });

export const clientUpdateNoaaMapping = (
  id: string,
  body: UpdateDynamicPricingNoaaMappingPayload,
) =>
  bff(`noaa-mappings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientCreateNoaaMapping = (
  body: CreateDynamicPricingNoaaMappingPayload,
) => bff(`noaa-mappings`, { method: 'POST', body: JSON.stringify(body) });

export const clientCreateHoliday = (body: CreateDynamicPricingHolidayPayload) =>
  bff('holidays', { method: 'POST', body: JSON.stringify(body) });

export const clientUpdateHoliday = (
  id: string,
  body: UpdateDynamicPricingHolidayPayload,
) => bff(`holidays/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientUpdateSettings = (body: Partial<DynamicPricingTenantSettings>) =>
  bff<DynamicPricingTenantSettings>('settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const clientApproveDemandSurge = (
  id: string,
  body: ApproveDemandSurgeSuggestionPayload,
) => bff(`demand-surge/suggestions/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });

export const clientDismissDemandSurge = (id: string) =>
  bff<void>(`demand-surge/suggestions/${id}/dismiss`, { method: 'POST' });

export const clientDeclineQuote = (jobId: string, body: DeclineQuotePayload) =>
  bff(`quotes/${jobId}/decline`, { method: 'POST', body: JSON.stringify(body) });

export const clientSaveStepRespond = (jobId: string, body: SaveStepResponsePayload) =>
  bff(`quotes/${jobId}/save-step`, { method: 'POST', body: JSON.stringify(body) });
