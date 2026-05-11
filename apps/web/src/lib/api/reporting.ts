/**
 * Server-side fetchers for the reporting module. Mirrors lib/api/billing.ts.
 */
import type {
  CreateSavedReportPayload,
  ExportReportPayload,
  ExportReportResponse,
  ReportDetailDto,
  ReportFiltersBase,
  ReportId,
  ReportSummaryDto,
  SavedReportDto,
  UpdateSavedReportPayload,
} from '@ustowdispatch/shared';
import { apiServer, apiServerBff } from './client';

export interface ReportIndexCard {
  id: ReportId;
  title: string;
  description: string;
  allowed: boolean;
}

export async function fetchReportIndex(): Promise<{ reports: ReportIndexCard[] }> {
  return apiServer<{ reports: ReportIndexCard[] }>('/reporting');
}

export async function fetchReportSummary(
  reportId: ReportId,
  filters: Partial<ReportFiltersBase> = {},
): Promise<ReportSummaryDto> {
  return apiServer<ReportSummaryDto>(`/reporting/${reportId}/summary${toQuery(filters)}`);
}

export async function fetchReportDetail(
  reportId: ReportId,
  filters: Partial<ReportFiltersBase> = {},
): Promise<ReportDetailDto> {
  return apiServer<ReportDetailDto>(`/reporting/${reportId}${toQuery(filters)}`);
}

export async function fetchSavedReports(): Promise<{ data: SavedReportDto[] }> {
  return apiServer<{ data: SavedReportDto[] }>('/reporting/saved');
}

export async function createSavedReport(
  payload: CreateSavedReportPayload,
): Promise<SavedReportDto> {
  return apiServerBff<SavedReportDto, CreateSavedReportPayload>('/reporting/saved', {
    method: 'POST',
    body: payload,
  });
}

export async function updateSavedReport(
  id: string,
  payload: UpdateSavedReportPayload,
): Promise<SavedReportDto> {
  return apiServerBff<SavedReportDto, UpdateSavedReportPayload>(`/reporting/saved/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function deleteSavedReport(id: string): Promise<void> {
  return apiServerBff<void>(`/reporting/saved/${id}`, { method: 'DELETE' });
}

export async function exportReport(
  reportId: ReportId,
  payload: ExportReportPayload,
): Promise<ExportReportResponse> {
  return apiServerBff<ExportReportResponse, ExportReportPayload>(`/reporting/${reportId}/export`, {
    method: 'POST',
    body: payload,
  });
}

function toQuery(q: Record<string, unknown>): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, String(v));
  return `?${params.toString()}`;
}

export function formatMoneyCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}
