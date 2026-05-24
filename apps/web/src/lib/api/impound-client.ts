/**
 * Browser-side helpers for /api/impound/* — hits the BFF; never imports
 * next/headers. Mirrors the tier-offers-client.ts shape.
 */
import type {
  AddImpoundFeePayload,
  AddImpoundHoldPayload,
  CloseImpoundRecordPayload,
  CreateImpoundRecordPayload,
  CreateImpoundReleasePayload,
  CreateImpoundYardPayload,
  ImpoundFeeDto,
  ImpoundHoldDto,
  ImpoundRecordDetailDto,
  ImpoundRecordDto,
  ImpoundReleaseDto,
  ImpoundYardDto,
  ListImpoundRecordsFilter,
  RegisterImpoundPhotosPayload,
  UpdateImpoundRecordPayload,
  UpdateImpoundYardPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/impound/${path}`, {
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

// Yards
export const clientListYards = () => bff<ImpoundYardDto[]>('yards');
export const clientCreateYard = (body: CreateImpoundYardPayload) =>
  bff<ImpoundYardDto>('yards', { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateYard = (id: string, body: UpdateImpoundYardPayload) =>
  bff<ImpoundYardDto>(`yards/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientDeleteYard = (id: string) => bff<void>(`yards/${id}`, { method: 'DELETE' });

// Records
export function clientListRecords(
  filter: ListImpoundRecordsFilter = {},
): Promise<ImpoundRecordDto[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set('status', filter.status);
  if (filter.yardId) qs.set('yardId', filter.yardId);
  if (filter.lienEligible) qs.set('lienEligible', filter.lienEligible);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return bff<ImpoundRecordDto[]>(`records${suffix}`);
}
export const clientGetRecord = (id: string) => bff<ImpoundRecordDetailDto>(`records/${id}`);
export const clientIntakeRecord = (body: CreateImpoundRecordPayload) =>
  bff<ImpoundRecordDto>('records', { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateRecord = (id: string, body: UpdateImpoundRecordPayload) =>
  bff<ImpoundRecordDto>(`records/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientRegisterPhotos = (id: string, body: RegisterImpoundPhotosPayload) =>
  bff<ImpoundRecordDto>(`records/${id}/photos`, { method: 'POST', body: JSON.stringify(body) });
export const clientCloseRecord = (id: string, body: CloseImpoundRecordPayload) =>
  bff<ImpoundRecordDto>(`records/${id}/close`, { method: 'POST', body: JSON.stringify(body) });

// Holds
export const clientAddHold = (id: string, body: AddImpoundHoldPayload) =>
  bff<ImpoundHoldDto>(`records/${id}/holds`, { method: 'POST', body: JSON.stringify(body) });
export const clientReleaseHold = (id: string, holdId: string, notes?: string) =>
  bff<ImpoundHoldDto>(`records/${id}/holds/${holdId}/release`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {}),
  });

// Fees
export const clientAddFee = (id: string, body: AddImpoundFeePayload) =>
  bff<ImpoundFeeDto>(`records/${id}/fees`, { method: 'POST', body: JSON.stringify(body) });

// Release
export const clientReleaseRecord = (id: string, body: CreateImpoundReleasePayload) =>
  bff<{ record: ImpoundRecordDto; release: ImpoundReleaseDto }>(`records/${id}/release`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
