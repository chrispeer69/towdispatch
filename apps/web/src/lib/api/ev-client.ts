/**
 * Browser-side helpers for /api/ev-recovery/* — hits the BFF; never imports
 * next/headers. Mirrors the lien-client.ts shape.
 */
import type {
  EvJobDetailDto,
  EvOemProcedureDto,
  LogChargeStopPayload,
  MarkJobEvPayload,
  RecordEvIntakePayload,
  ReportThermalEventPayload,
} from '@ustowdispatch/shared';

const BASE = '/api/ev-recovery';

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

export const clientGetEvDetail = (jobId: string) => req<EvJobDetailDto>(`${BASE}/jobs/${jobId}`);

export const clientMarkJobEv = (jobId: string, body: MarkJobEvPayload) =>
  req<EvJobDetailDto>(`${BASE}/jobs/${jobId}`, { method: 'POST', body: JSON.stringify(body) });

export const clientRecordIntake = (jobId: string, body: RecordEvIntakePayload) =>
  req<EvJobDetailDto>(`${BASE}/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const clientReportThermalEvent = (jobId: string, body: ReportThermalEventPayload) =>
  req<EvJobDetailDto>(`${BASE}/jobs/${jobId}/thermal-events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const clientLogChargeStop = (jobId: string, body: LogChargeStopPayload) =>
  req<EvJobDetailDto>(`${BASE}/jobs/${jobId}/charge-stops`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const clientListOemProcedures = () => req<EvOemProcedureDto[]>(`${BASE}/oem-procedures`);

export function clientLookupOem(
  make: string,
  model?: string,
  year?: number,
): Promise<EvOemProcedureDto | null> {
  const qs = new URLSearchParams({ make });
  if (model) qs.set('model', model);
  if (year) qs.set('year', String(year));
  return req<EvOemProcedureDto | null>(`${BASE}/oem-procedures/lookup?${qs.toString()}`);
}
