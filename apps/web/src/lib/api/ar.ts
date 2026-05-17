/**
 * Server-side typed fetchers for the Build 5 A/R module. Mirrors the
 * billing/accounts patterns: every call goes through apiServer so the
 * access cookie stays server-only, and callers pass the accessToken
 * from the page (Next.js 15's dynamic-API scope doesn't survive the
 * extra module hop in prod builds).
 */
import type {
  ArReportFilters,
  ArReportId,
  ArReportResponse,
  ArSearchResponse,
  RedAlertSendDto,
  StatementPreviewPayload,
  StatementPreviewResponse,
  StatementSendDto,
  StatementSendPayload,
  TenantInvoiceDefaults,
  UpdateTenantInvoiceDefaultsPayload,
} from '@ustowdispatch/shared';
import { apiServer } from './client';

type StringQuery = Record<string, string | undefined>;

function toQuery(q: StringQuery): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, v as string);
  return `?${params.toString()}`;
}

export async function fetchArSearch(
  query: StringQuery,
  accessToken?: string | null,
): Promise<ArSearchResponse> {
  return apiServer<ArSearchResponse>(`/ar/search${toQuery(query)}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchArReport(
  reportId: ArReportId,
  query: StringQuery,
  accessToken?: string | null,
): Promise<ArReportResponse> {
  return apiServer<ArReportResponse>(`/ar/reports/${reportId}${toQuery(query)}`, {
    accessToken: accessToken ?? null,
  });
}

export async function fetchStatementPreview(
  body: StatementPreviewPayload,
  accessToken?: string | null,
): Promise<StatementPreviewResponse> {
  return apiServer<StatementPreviewResponse>('/ar/statements/preview', {
    method: 'POST',
    body,
    accessToken: accessToken ?? null,
  });
}

export async function fetchRecentStatementSends(
  accessToken?: string | null,
): Promise<StatementSendDto[]> {
  return apiServer<StatementSendDto[]>('/ar/statements/recent', {
    accessToken: accessToken ?? null,
  });
}

export async function fetchRecentRedAlertSends(
  accessToken?: string | null,
): Promise<RedAlertSendDto[]> {
  return apiServer<RedAlertSendDto[]>('/ar/red-alert/recent', {
    accessToken: accessToken ?? null,
  });
}

export async function fetchTenantInvoiceDefaults(
  accessToken?: string | null,
): Promise<TenantInvoiceDefaults> {
  return apiServer<TenantInvoiceDefaults>('/ar/invoice-defaults', {
    accessToken: accessToken ?? null,
  });
}

// ----- Client-side helpers (run in the browser; hit the BFF directly) -----

export async function clientSendStatement(
  payload: StatementSendPayload,
): Promise<StatementSendDto> {
  const res = await fetch('/api/ar/statements/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Send failed (${res.status})`);
  }
  return (await res.json()) as StatementSendDto;
}

export async function clientRunArSearch(query: StringQuery): Promise<ArSearchResponse> {
  const res = await fetch(`/api/ar/search${toQuery(query)}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Search failed (${res.status})`);
  }
  return (await res.json()) as ArSearchResponse;
}

export async function clientRunReport(
  reportId: ArReportId,
  filters: Partial<ArReportFilters> & { format?: 'json' | 'xlsx' | 'pdf' },
): Promise<ArReportResponse> {
  const query: StringQuery = {
    format: filters.format ?? 'json',
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.groupBy ? { groupBy: filters.groupBy } : {}),
  };
  const res = await fetch(`/api/ar/reports/${reportId}${toQuery(query)}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Report failed (${res.status})`);
  }
  return (await res.json()) as ArReportResponse;
}

/**
 * Trigger a binary download for xlsx/pdf reports. The browser handles
 * the actual save; we just need to hit the URL with the right query.
 */
export function reportDownloadUrl(
  reportId: ArReportId,
  format: 'xlsx' | 'pdf',
  filters: Partial<ArReportFilters>,
): string {
  const query: StringQuery = {
    format,
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.groupBy ? { groupBy: filters.groupBy } : {}),
  };
  return `/api/ar/reports/${reportId}${toQuery(query)}`;
}

export async function clientUpdateInvoiceDefaults(
  patch: UpdateTenantInvoiceDefaultsPayload,
): Promise<TenantInvoiceDefaults> {
  const res = await fetch('/api/ar/invoice-defaults', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Save failed (${res.status})`);
  }
  return (await res.json()) as TenantInvoiceDefaults;
}

export async function clientRunRedAlertNow(): Promise<RedAlertSendDto> {
  const res = await fetch('/api/ar/red-alert/run-now', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Red alert run failed (${res.status})`);
  }
  return (await res.json()) as RedAlertSendDto;
}
