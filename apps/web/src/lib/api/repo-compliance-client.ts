/**
 * Browser-side helpers for /api/repo-compliance/* — hits the BFF; never imports
 * next/headers. Mirrors lien-client.ts. Self-contained: the S49 case-bound
 * routes are not wired yet (see SESSION_50_DECISIONS.md).
 */
import type {
  RecordRepoNoticePayload,
  RecordRepoNoticeResponsePayload,
  RepoAttemptFacts,
  RepoCaseFacts,
  RepoFormType,
  RepoNextAction,
  RepoPeacefulResult,
  RepoPersonalPropertyHoldRequest,
  RepoPersonalPropertyHoldResult,
  RepoRequiredNoticeDto,
  RepoStateRulesDto,
  RepoTimelineEventDto,
} from '@ustowdispatch/shared';

const BASE = '/api/repo-compliance';

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

export const clientListStateRules = () => req<RepoStateRulesDto[]>(`${BASE}/state-rules`);
export const clientGetStateRule = (state: string) =>
  req<RepoStateRulesDto>(`${BASE}/state-rules/${state}`);

export const clientNextAction = (facts: RepoCaseFacts) =>
  req<RepoNextAction>(`${BASE}/next-action`, { method: 'POST', body: JSON.stringify(facts) });

export const clientValidatePeacefulRepo = (attempt: RepoAttemptFacts) =>
  req<RepoPeacefulResult>(`${BASE}/validate-peaceful-repo`, {
    method: 'POST',
    body: JSON.stringify(attempt),
  });

export const clientPersonalPropertyHold = (input: RepoPersonalPropertyHoldRequest) =>
  req<RepoPersonalPropertyHoldResult>(`${BASE}/personal-property-hold`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const clientListNotices = (repoCaseId: string) =>
  req<RepoRequiredNoticeDto[]>(`${BASE}/notices?repoCaseId=${encodeURIComponent(repoCaseId)}`);
export const clientRecordNotice = (body: RecordRepoNoticePayload) =>
  req<RepoRequiredNoticeDto>(`${BASE}/notices`, { method: 'POST', body: JSON.stringify(body) });
export const clientRecordNoticeResponse = (
  noticeId: string,
  body: RecordRepoNoticeResponsePayload,
) =>
  req<RepoRequiredNoticeDto>(`${BASE}/notices/${noticeId}/response`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientListTimeline = (repoCaseId: string) =>
  req<RepoTimelineEventDto[]>(`${BASE}/cases/${repoCaseId}/timeline`);

/** Direct link to the binary PDF route (POST-rendered; opened via fetch/blob). */
export const repoFormPath = (formType: RepoFormType): string => `${BASE}/forms/${formType}`;
