/**
 * Browser-side helpers for /api/ai-dispatch/* — hits the BFF; never imports
 * next/headers. Mirrors ev-client.ts. Advisory only — these never assign a job.
 */
import type {
  DispatchRecommendationDto,
  EtaResultDto,
  RecommendQuery,
} from '@ustowdispatch/shared';

const BASE = '/api/ai-dispatch';

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

export const clientGetRecommendations = (jobId: string) =>
  req<DispatchRecommendationDto | null>(`${BASE}/jobs/${jobId}/recommendations`);

export const clientRecomputeRecommendations = (jobId: string, q: RecommendQuery = {}) => {
  const qs = q.limit ? `?limit=${q.limit}` : '';
  return req<DispatchRecommendationDto>(`${BASE}/jobs/${jobId}/recommendations${qs}`, {
    method: 'POST',
  });
};

export const clientGetEta = (jobId: string) => req<EtaResultDto>(`${BASE}/jobs/${jobId}/eta`);
