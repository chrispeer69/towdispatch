/**
 * /repo/cases — list page for the repossession workflow.
 *
 * Server-fetches the case roster (optionally filtered by status + lienholder)
 * and hands it to the client list. The repo module ships dark behind the API's
 * REPO_MODULE_ENABLED flag (503 repo_module_disabled when off); roles the API
 * gates out get 403. Both render a calm explainer instead of crashing the route.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { RepoCaseDto, RepoCaseStatus } from '@ustowdispatch/shared';
import { repoCaseStatusValues } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { RepoUnavailable } from '../repo-unavailable';
import { RepoCaseListClient } from './list-client';

export const metadata = { title: 'Repo Cases — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: RepoCaseStatus;
  lienholderId?: string;
}

export default async function RepoCasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const statusFilter =
    params.status && repoCaseStatusValues.includes(params.status) ? params.status : null;
  const lienholderId = params.lienholderId ?? null;
  const token = await getSessionToken();

  const qs = new URLSearchParams();
  if (statusFilter) qs.set('status', statusFilter);
  if (lienholderId) qs.set('lienholderId', lienholderId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  let cases: RepoCaseDto[];
  try {
    cases = await apiServer<RepoCaseDto[]>(`/repo-cases${suffix}`, { accessToken: token ?? null });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'repo_module_disabled' || err.status === 503) {
        return <RepoUnavailable kind="disabled" />;
      }
      if (err.status === 403) {
        return <RepoUnavailable kind="forbidden" />;
      }
    }
    throw err;
  }

  return <RepoCaseListClient cases={cases} status={statusFilter} lienholderId={lienholderId} />;
}
