/**
 * Server-side fetchers for the Session 53 reporting surfaces — custom builder,
 * KPI dashboard, P&L, and aging. Mirrors lib/api/reporting.ts. All routes live
 * under /reporting/* so they ride the existing /api/reporting/[...path] BFF.
 */
import type {
  AgingReportResponse,
  ExecuteReportResult,
  KpiLayoutDto,
  KpiValueDto,
  KpiWidgetCatalogDto,
  KpiWidgetId,
  PnlResponse,
  ReportTemplateDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

export function fetchKpiCatalog(): Promise<{ data: KpiWidgetCatalogDto[] }> {
  return apiServer<{ data: KpiWidgetCatalogDto[] }>('/reporting/kpi/widgets');
}

export function fetchKpiWidget(id: KpiWidgetId, compareTo?: string): Promise<KpiValueDto> {
  const q = compareTo ? `?compare_to=${encodeURIComponent(compareTo)}` : '';
  return apiServer<KpiValueDto>(`/reporting/kpi/widgets/${id}${q}`);
}

export function fetchKpiLayout(): Promise<KpiLayoutDto> {
  return apiServer<KpiLayoutDto>('/reporting/kpi/layouts/me');
}

export function fetchBuilderTemplates(): Promise<{ data: ReportTemplateDto[] }> {
  return apiServer<{ data: ReportTemplateDto[] }>('/reporting/builder/templates');
}

export function runBuilderTemplate(id: string): Promise<ExecuteReportResult> {
  return apiServer<ExecuteReportResult>(`/reporting/builder/templates/${id}/run`, {
    method: 'POST',
  });
}

export function fetchPnl(
  dimension: 'accounts' | 'motor-clubs',
  from: string,
  to: string,
): Promise<PnlResponse> {
  return apiServer<PnlResponse>(
    `/reporting/pnl/${dimension}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function fetchAging(bucketDays = '30,60,90'): Promise<AgingReportResponse> {
  return apiServer<AgingReportResponse>(`/reporting/aging?bucket_days=${bucketDays}`);
}
