/**
 * Browser-side helpers for /api/yard/* — hits the BFF; never imports
 * next/headers. Mirrors lien-client.ts.
 */
import type {
  AuthorizeLienholderPayload,
  BulkStallLayoutPayload,
  CancelReleasePayload,
  CollectReleasePaymentPayload,
  CreateStorageRateCardPayload,
  CreateYardFacilityPayload,
  CreateYardStallPayload,
  GateSearchResult,
  RegisterStallPhotoPayload,
  ReleaseWorkflowDto,
  StorageBillingRunDto,
  StorageBillingTickResult,
  StorageRateCardDto,
  StorageVehicleClass,
  UpdateYardFacilityPayload,
  UpdateYardStallPayload,
  VerifyReleaseIdPayload,
  YardFacilityDto,
  YardStallDetailDto,
  YardStallDto,
  YardStallPhotoDto,
} from '@ustowdispatch/shared';

const BASE = '/api/yard';

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

// ---- facilities ----
export const listFacilities = (): Promise<YardFacilityDto[]> =>
  req<YardFacilityDto[]>(`${BASE}/facilities`);
export const getFacility = (id: string): Promise<YardFacilityDto> =>
  req<YardFacilityDto>(`${BASE}/facilities/${id}`);
export const createFacility = (body: CreateYardFacilityPayload): Promise<YardFacilityDto> =>
  req<YardFacilityDto>(`${BASE}/facilities`, { method: 'POST', body: JSON.stringify(body) });
export const updateFacility = (
  id: string,
  body: UpdateYardFacilityPayload,
): Promise<YardFacilityDto> =>
  req<YardFacilityDto>(`${BASE}/facilities/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteFacility = (id: string): Promise<null> =>
  req<null>(`${BASE}/facilities/${id}`, { method: 'DELETE' });

// ---- stalls ----
export const listStalls = (facilityId: string): Promise<YardStallDto[]> =>
  req<YardStallDto[]>(`${BASE}/facilities/${facilityId}/stalls`);
export const createStall = (
  facilityId: string,
  body: CreateYardStallPayload,
): Promise<YardStallDto> =>
  req<YardStallDto>(`${BASE}/facilities/${facilityId}/stalls`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const bulkLayout = (
  facilityId: string,
  body: BulkStallLayoutPayload,
): Promise<YardStallDto[]> =>
  req<YardStallDto[]>(`${BASE}/facilities/${facilityId}/stalls/bulk-layout`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const getStall = (stallId: string): Promise<YardStallDetailDto> =>
  req<YardStallDetailDto>(`${BASE}/stalls/${stallId}`);
export const updateStall = (stallId: string, body: UpdateYardStallPayload): Promise<YardStallDto> =>
  req<YardStallDto>(`${BASE}/stalls/${stallId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteStall = (stallId: string): Promise<null> =>
  req<null>(`${BASE}/stalls/${stallId}`, { method: 'DELETE' });
export const assignStall = (stallId: string, impoundId: string): Promise<YardStallDto> =>
  req<YardStallDto>(`${BASE}/stalls/${stallId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ impoundId }),
  });
export const releaseStall = (stallId: string): Promise<YardStallDto> =>
  req<YardStallDto>(`${BASE}/stalls/${stallId}/release`, { method: 'POST' });
export const registerStallPhoto = (
  stallId: string,
  body: RegisterStallPhotoPayload,
): Promise<YardStallPhotoDto> =>
  req<YardStallPhotoDto>(`${BASE}/stalls/${stallId}/photos`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ---- rate cards ----
export const listRateCards = (
  facilityId: string,
  vehicleClass?: StorageVehicleClass,
): Promise<StorageRateCardDto[]> =>
  req<StorageRateCardDto[]>(
    `${BASE}/facilities/${facilityId}/rate-cards${vehicleClass ? `?vehicleClass=${vehicleClass}` : ''}`,
  );
export const createRateCard = (
  facilityId: string,
  body: CreateStorageRateCardPayload,
): Promise<StorageRateCardDto> =>
  req<StorageRateCardDto>(`${BASE}/facilities/${facilityId}/rate-cards`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const deleteRateCard = (id: string): Promise<null> =>
  req<null>(`${BASE}/rate-cards/${id}`, { method: 'DELETE' });

// ---- gate search ----
export const gateSearch = (q: string): Promise<GateSearchResult> =>
  req<GateSearchResult>(`${BASE}/gate-search?q=${encodeURIComponent(q)}`);

// ---- billing ----
export const listBillingRuns = (): Promise<StorageBillingRunDto[]> =>
  req<StorageBillingRunDto[]>(`${BASE}/billing/runs`);
export const runBillingNow = (): Promise<StorageBillingTickResult> =>
  req<StorageBillingTickResult>(`${BASE}/billing/run-now`, { method: 'POST' });

// ---- release workflow ----
export const getRelease = (impoundId: string): Promise<ReleaseWorkflowDto | null> =>
  req<ReleaseWorkflowDto | null>(`${BASE}/release/${impoundId}`);
export const initiateRelease = (impoundId: string): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release`, {
    method: 'POST',
    body: JSON.stringify({ impoundId }),
  });
export const verifyReleaseId = (
  workflowId: string,
  body: VerifyReleaseIdPayload,
): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release/${workflowId}/verify-id`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const authorizeReleaseLienholder = (
  workflowId: string,
  body: AuthorizeLienholderPayload,
): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release/${workflowId}/authorize-lienholder`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const collectReleasePayment = (
  workflowId: string,
  body: CollectReleasePaymentPayload,
): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release/${workflowId}/collect-payment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const gateReleaseWorkflow = (workflowId: string): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release/${workflowId}/gate-release`, { method: 'POST' });
export const cancelRelease = (
  workflowId: string,
  body: CancelReleasePayload,
): Promise<ReleaseWorkflowDto> =>
  req<ReleaseWorkflowDto>(`${BASE}/release/${workflowId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
