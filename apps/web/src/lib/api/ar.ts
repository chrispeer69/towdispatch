/**
 * Server-side typed fetchers for the Build 5 A/R module. Mirrors the
 * billing/accounts patterns: every call goes through apiServer so the
 * access cookie stays server-only, and callers pass the accessToken
 * from the page (Next.js 15's dynamic-API scope doesn't survive the
 * extra module hop in prod builds).
 *
 * Client-side counterparts (fetch against the BFF) live in `./ar-client`
 * so client components can import them without dragging `next/headers`
 * into the client bundle (Next 15 forbids that import in client code).
 */
import type {
  ArReportId,
  ArReportResponse,
  ArSearchResponse,
  RedAlertSendDto,
  StatementPreviewPayload,
  StatementPreviewResponse,
  StatementSendDto,
  TenantInvoiceDefaults,
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
