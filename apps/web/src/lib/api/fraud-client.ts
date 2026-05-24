/**
 * Browser-side helpers for /api/fraud/* — hits the BFF, which proxies to the
 * API's fraud-detection module. Never imports next/headers. Mirrors the
 * lien-client.ts shape.
 */
import type {
  DisputeOutcomeDto,
  DisputeRecordDto,
  DisputeStatsDto,
  HighRiskListItemDto,
  JobRiskDetailDto,
  ListDisputesFilter,
  ListHighRiskFilter,
  RecordDisputePayload,
  RecordFraudOutcomePayload,
  ResolveDisputePayload,
  ReviewFraudScorePayload,
} from '@ustowdispatch/shared';

const BASE = '/api/fraud';

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

export function clientListHighRisk(
  filter: ListHighRiskFilter = {},
): Promise<HighRiskListItemDto[]> {
  const qs = new URLSearchParams();
  if (filter.band) qs.set('band', filter.band);
  if (filter.days) qs.set('days', String(filter.days));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<HighRiskListItemDto[]>(`${BASE}/high-risk${suffix}`);
}

export const clientGetJobRisk = (jobId: string) => req<JobRiskDetailDto>(`${BASE}/jobs/${jobId}`);

export const clientScoreJob = (jobId: string) =>
  req<JobRiskDetailDto>(`${BASE}/jobs/${jobId}/score`, { method: 'POST', body: '{}' });

export const clientReviewJob = (jobId: string, body: ReviewFraudScorePayload) =>
  req<JobRiskDetailDto>(`${BASE}/jobs/${jobId}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export function clientListDisputes(filter: ListDisputesFilter = {}): Promise<DisputeRecordDto[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set('status', filter.status);
  if (filter.motorClubName) qs.set('motorClubName', filter.motorClubName);
  if (filter.days) qs.set('days', String(filter.days));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<DisputeRecordDto[]>(`${BASE}/disputes${suffix}`);
}

export const clientRecordDispute = (body: RecordDisputePayload) =>
  req<DisputeRecordDto>(`${BASE}/disputes`, { method: 'POST', body: JSON.stringify(body) });

export const clientResolveDispute = (id: string, body: ResolveDisputePayload) =>
  req<DisputeRecordDto>(`${BASE}/disputes/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const clientRecordOutcome = (id: string, body: RecordFraudOutcomePayload) =>
  req<DisputeOutcomeDto>(`${BASE}/disputes/${id}/outcome`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const clientDisputeStats = (days?: number) =>
  req<DisputeStatsDto>(`${BASE}/reports/dispute-stats${days ? `?days=${days}` : ''}`);
