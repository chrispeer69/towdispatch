/**
 * Browser-side helpers for /api/lien-cases/* — hits the BFF; never imports
 * next/headers. Mirrors the impound-client.ts shape. The list + open root
 * (`/api/lien-cases`) is served by api/lien-cases/route.ts; everything with a
 * sub-path by api/lien-cases/[...path]/route.ts.
 */
import type {
  AdvanceLienCasePayload,
  CloseLienCasePayload,
  LienCaseDetailDto,
  LienCaseDto,
  LienFormType,
  LienStateRulesDto,
  ListLienCasesFilter,
  OpenLienCasePayload,
  RecordLienNoticePayload,
  RecordLienResponsePayload,
  UpdateLienCasePayload,
} from '@ustowdispatch/shared';

const BASE = '/api/lien-cases';

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

export function clientListCases(filter: ListLienCasesFilter = {}): Promise<LienCaseDto[]> {
  const qs = new URLSearchParams();
  if (filter.state) qs.set('state', filter.state);
  if (filter.status) qs.set('status', filter.status);
  if (filter.step) qs.set('step', filter.step);
  if (filter.dueSoon) qs.set('dueSoon', filter.dueSoon);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<LienCaseDto[]>(`${BASE}${suffix}`);
}

export const clientListStateRules = () => req<LienStateRulesDto[]>(`${BASE}/state-rules`);
export const clientGetCase = (id: string) => req<LienCaseDetailDto>(`${BASE}/${id}`);
export const clientOpenCase = (body: OpenLienCasePayload) =>
  req<LienCaseDetailDto>(BASE, { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateCase = (id: string, body: UpdateLienCasePayload) =>
  req<LienCaseDetailDto>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientAdvanceCase = (id: string, body: AdvanceLienCasePayload = {}) =>
  req<LienCaseDetailDto>(`${BASE}/${id}/advance`, { method: 'POST', body: JSON.stringify(body) });
export const clientRecordNotice = (id: string, body: RecordLienNoticePayload) =>
  req<LienCaseDetailDto>(`${BASE}/${id}/notices`, { method: 'POST', body: JSON.stringify(body) });
export const clientRecordResponse = (
  id: string,
  noticeId: string,
  body: RecordLienResponsePayload,
) =>
  req<LienCaseDetailDto>(`${BASE}/${id}/notices/${noticeId}/response`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const clientCloseCase = (id: string, body: CloseLienCasePayload) =>
  req<LienCaseDetailDto>(`${BASE}/${id}/close`, { method: 'POST', body: JSON.stringify(body) });

/** Direct link to the binary PDF route (opened in a new tab). */
export const lienFormUrl = (id: string, formType: LienFormType): string =>
  `${BASE}/${id}/forms/${formType}`;
