/**
 * Browser-side helpers for /api/heavy-duty/* — hits the BFF; never imports
 * next/headers. Mirrors impound-client.ts.
 */
import type {
  CreateHdRateSheetPayload,
  FinalizeHdInvoicePayload,
  GenerateHdEstimatePayload,
  HdCertExpiryReportDto,
  HdDriverCertificationDto,
  HdEquipmentUtilizationReportDto,
  HdJobAttributeDto,
  HdJobDetailDto,
  HdJobsByMonthReportDto,
  HdOnSceneEstimateDto,
  HdRateSheetDto,
  HdTruckCapabilityDto,
  MarkJobHdPayload,
  RecordHdDriverCertPayload,
  SetHdTruckCapabilitiesPayload,
  UpdateHdRateSheetPayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/heavy-duty/${path}`, {
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

// Truck capabilities
export const clientListTruckCapabilities = () => bff<HdTruckCapabilityDto[]>('trucks/capabilities');
export const clientGetTruckCapabilities = (truckId: string) =>
  bff<HdTruckCapabilityDto | null>(`trucks/${truckId}/capabilities`);
export const clientSetTruckCapabilities = (truckId: string, body: SetHdTruckCapabilitiesPayload) =>
  bff<HdTruckCapabilityDto>(`trucks/${truckId}/capabilities`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// Driver certifications
export const clientListDriverCerts = (driverId: string) =>
  bff<HdDriverCertificationDto[]>(`drivers/${driverId}/certifications`);
export const clientRecordDriverCert = (driverId: string, body: RecordHdDriverCertPayload) =>
  bff<HdDriverCertificationDto>(`drivers/${driverId}/certifications`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// Job attributes + eligibility
export const clientGetJobDetail = (jobId: string) => bff<HdJobDetailDto>(`jobs/${jobId}`);
export const clientMarkJobHd = (jobId: string, body: MarkJobHdPayload) =>
  bff<HdJobAttributeDto>(`jobs/${jobId}`, { method: 'PUT', body: JSON.stringify(body) });
export const clientGenerateEstimate = (jobId: string, body: GenerateHdEstimatePayload) =>
  bff<HdOnSceneEstimateDto>(`jobs/${jobId}/estimate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientFinalizeInvoice = (jobId: string, body: FinalizeHdInvoicePayload) =>
  bff<HdJobAttributeDto>(`jobs/${jobId}/finalize`, { method: 'POST', body: JSON.stringify(body) });

// Rate sheets
export const clientListRateSheets = () => bff<HdRateSheetDto[]>('rate-sheets');
export const clientCreateRateSheet = (body: CreateHdRateSheetPayload) =>
  bff<HdRateSheetDto>('rate-sheets', { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateRateSheet = (id: string, body: UpdateHdRateSheetPayload) =>
  bff<HdRateSheetDto>(`rate-sheets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientDeleteRateSheet = (id: string) =>
  bff<void>(`rate-sheets/${id}`, { method: 'DELETE' });

// Reports
export const clientReportJobsByMonth = () => bff<HdJobsByMonthReportDto>('reports/jobs-by-month');
export const clientReportCertExpiry = (windowDays = 60) =>
  bff<HdCertExpiryReportDto>(`reports/cert-expiry?windowDays=${windowDays}`);
export const clientReportEquipmentUtilization = () =>
  bff<HdEquipmentUtilizationReportDto>('reports/equipment-utilization');
