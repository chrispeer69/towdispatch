/**
 * Client-side helpers for the Build 5 A/R module. These run in the
 * browser and hit the BFF routes under `/api/ar/*` directly — no
 * `next/headers` (which would force this module into the server-only
 * graph and block use from `'use client'` components).
 *
 * Server-side counterparts live in `./ar`.
 */
import type {
  ArReportFilters,
  ArReportId,
  ArReportResponse,
  ArSearchResponse,
  RedAlertSendDto,
  StatementSendDto,
  StatementSendPayload,
  TenantInvoiceDefaults,
  UpdateTenantInvoiceDefaultsPayload,
} from '@ustowdispatch/shared';

type StringQuery = Record<string, string | undefined>;

function toQuery(q: StringQuery): string {
  const entries = Object.entries(q).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.set(k, v as string);
  return `?${params.toString()}`;
}

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
