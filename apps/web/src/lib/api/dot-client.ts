/**
 * Browser-side helpers for /api/dot/* — hits the BFF; never imports
 * next/headers. Mirrors the impound-client.ts `bff<T>` helper shape.
 */
import type {
  DotCarrierProfileDto,
  DotDriverDqViewDto,
  DotDrugAlcoholTestDto,
  DotHosLogDto,
  DotHosViolationReportRow,
  DotHosWeekResultDto,
  DotIncidentReportDto,
  DotOpenDvirDto,
  RecordDqEventPayload,
  RecordDrugTestPayload,
  RecordHosEntryPayload,
  RecordIncidentPayload,
  UpsertDotCarrierProfilePayload,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/dot/${path}`, {
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

// Carrier profile
export const getCarrierProfile = () => bff<DotCarrierProfileDto | null>('carrier-profile');
export const upsertCarrierProfile = (body: UpsertDotCarrierProfilePayload) =>
  bff<DotCarrierProfileDto>('carrier-profile', { method: 'PUT', body: JSON.stringify(body) });

// Driver qualifications
export const listDq = () => bff<DotDriverDqViewDto[]>('drivers/dq');
export const getDq = (driverId: string) => bff<DotDriverDqViewDto>(`drivers/${driverId}/dq`);
export const recordDqEvent = (body: RecordDqEventPayload) =>
  bff<DotDriverDqViewDto>('drivers/dq', { method: 'POST', body: JSON.stringify(body) });

// Hours of service
export function listHos(opts: {
  driverId?: string;
  from?: string;
  to?: string;
}): Promise<DotHosLogDto[]> {
  const qs = new URLSearchParams();
  if (opts.driverId) qs.set('driverId', opts.driverId);
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return bff<DotHosLogDto[]>(`hos${suffix}`);
}
export const recordHos = (body: RecordHosEntryPayload) =>
  bff<DotHosLogDto>('hos', { method: 'POST', body: JSON.stringify(body) });
export function getHosWeek(
  driverId: string,
  from: string,
  to: string,
): Promise<DotHosWeekResultDto> {
  const qs = new URLSearchParams({ from, to });
  return bff<DotHosWeekResultDto>(`hos/${driverId}/week?${qs.toString()}`);
}

// Drug & alcohol
export function listDrugTests(opts: {
  driverId?: string;
  testType?: string;
  result?: string;
}): Promise<DotDrugAlcoholTestDto[]> {
  const qs = new URLSearchParams();
  if (opts.driverId) qs.set('driverId', opts.driverId);
  if (opts.testType) qs.set('testType', opts.testType);
  if (opts.result) qs.set('result', opts.result);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return bff<DotDrugAlcoholTestDto[]>(`drug-tests${suffix}`);
}
export const recordDrugTest = (body: RecordDrugTestPayload) =>
  bff<DotDrugAlcoholTestDto>('drug-tests', { method: 'POST', body: JSON.stringify(body) });

// Incidents
export const listIncidents = () => bff<DotIncidentReportDto[]>('incidents');
export const recordIncident = (body: RecordIncidentPayload) =>
  bff<DotIncidentReportDto>('incidents', { method: 'POST', body: JSON.stringify(body) });

// Reports
export const hosViolationsReport = (days: number) =>
  bff<DotHosViolationReportRow[]>(`reports/hos-violations?days=${days}`);
export const dqDeficiencyReport = () => bff<DotDriverDqViewDto[]>('reports/dq-deficiencies');
export const openDvirReport = () => bff<DotOpenDvirDto[]>('reports/open-dvirs');

// Audit packet — binary PDF download
export async function downloadAuditPacket(from: string, to: string): Promise<void> {
  const qs = new URLSearchParams({ from, to });
  const res = await fetch(`/api/dot/audit-packet?${qs.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dot-audit-packet-${from}-${to}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
