/**
 * Browser-side helpers for /api/repo-cases/* and /api/lienholders/* — hits the
 * BFF; never imports next/headers. Mirrors the lien-client.ts shape. The repo
 * list + create root (`/api/repo-cases`) is served by api/repo-cases/route.ts;
 * everything with a sub-path by api/repo-cases/[...path]/route.ts. Lienholders
 * are served by the parallel api/lienholders routes.
 */
import type {
  AddRepoConditionPhotosPayload,
  AddRepoPersonalPropertyPayload,
  CloseRepoCasePayload,
  CreateLienholderPayload,
  CreateRepoCasePayload,
  GenerateRepoInvoicePayload,
  LienholderDto,
  ListLienholdersFilter,
  ListRepoCasesFilter,
  MarkRepoCaseLocatedPayload,
  RecordRepoAttemptPayload,
  RecordRepoRecoveryPayload,
  ReleaseRepoPersonalPropertyPayload,
  RepoCaseDetailDto,
  RepoCaseDto,
  RepoInvoicePreviewDto,
  UpdateLienholderPayload,
  UpdateRepoCasePayload,
} from '@ustowdispatch/shared';

const BASE = '/api/repo-cases';
const LIENHOLDERS = '/api/lienholders';

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

// ----------------------------------------------------------------------
// Repo cases
// ----------------------------------------------------------------------

export function clientListRepoCases(filter: ListRepoCasesFilter = {}): Promise<RepoCaseDto[]> {
  const qs = new URLSearchParams();
  if (filter.lienholderId) qs.set('lienholderId', filter.lienholderId);
  if (filter.status) qs.set('status', filter.status);
  if (filter.minDaysOpen !== undefined) qs.set('minDaysOpen', String(filter.minDaysOpen));
  if (filter.limit !== undefined) qs.set('limit', String(filter.limit));
  if (filter.offset !== undefined) qs.set('offset', String(filter.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<RepoCaseDto[]>(`${BASE}${suffix}`);
}

export const clientGetRepoCase = (id: string) => req<RepoCaseDetailDto>(`${BASE}/${id}`);
export const clientCreateRepoCase = (body: CreateRepoCasePayload) =>
  req<RepoCaseDetailDto>(BASE, { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateRepoCase = (id: string, body: UpdateRepoCasePayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientMarkLocated = (id: string, body: MarkRepoCaseLocatedPayload = {}) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/located`, { method: 'POST', body: JSON.stringify(body) });
export const clientRecordAttempt = (id: string, body: RecordRepoAttemptPayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/attempts`, { method: 'POST', body: JSON.stringify(body) });
export const clientRecordRecovery = (id: string, body: RecordRepoRecoveryPayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/recovery`, { method: 'POST', body: JSON.stringify(body) });
export const clientAddConditionPhotos = (id: string, body: AddRepoConditionPhotosPayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/condition-photos`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientAddPersonalProperty = (id: string, body: AddRepoPersonalPropertyPayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/personal-property`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientReleasePersonalProperty = (
  id: string,
  propertyId: string,
  body: ReleaseRepoPersonalPropertyPayload,
) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/personal-property/${propertyId}/release`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientCloseRepoCase = (id: string, body: CloseRepoCasePayload) =>
  req<RepoCaseDetailDto>(`${BASE}/${id}/close`, { method: 'POST', body: JSON.stringify(body) });
export const clientPreviewRepoInvoice = (id: string, body: GenerateRepoInvoicePayload) =>
  req<RepoInvoicePreviewDto>(`${BASE}/${id}/invoice-preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ----------------------------------------------------------------------
// Lienholders
// ----------------------------------------------------------------------

export function clientListLienholders(
  filter: ListLienholdersFilter = {},
): Promise<LienholderDto[]> {
  const qs = new URLSearchParams();
  if (filter.active) qs.set('active', filter.active);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<LienholderDto[]>(`${LIENHOLDERS}${suffix}`);
}

export const clientGetLienholder = (id: string) => req<LienholderDto>(`${LIENHOLDERS}/${id}`);
export const clientCreateLienholder = (body: CreateLienholderPayload) =>
  req<LienholderDto>(LIENHOLDERS, { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateLienholder = (id: string, body: UpdateLienholderPayload) =>
  req<LienholderDto>(`${LIENHOLDERS}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientDeleteLienholder = (id: string) =>
  req<null>(`${LIENHOLDERS}/${id}`, { method: 'DELETE' });
