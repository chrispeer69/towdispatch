/**
 * /repo/lienholders — lienholder book for the repossession workflow.
 *
 * Server-fetches the full lienholder roster and hands it to the client CRUD
 * surface. The repo module ships dark behind the API's REPO_MODULE_ENABLED
 * flag (503 when off); roles the API gates out get 403. Both render a calm
 * explainer instead of crashing the route.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienholderDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { RepoUnavailable } from '../repo-unavailable';
import { LienholdersClient } from './lienholders-client';

export const metadata = { title: 'Lienholders — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function LienholdersPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  let lienholders: LienholderDto[];
  try {
    lienholders = await apiServer<LienholderDto[]>('/lienholders', { accessToken: token ?? null });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'repo_module_disabled' || err.status === 503) {
        return (
          <RepoUnavailable
            kind="disabled"
            title="Lienholders"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
      if (err.status === 403) {
        return (
          <RepoUnavailable
            kind="forbidden"
            title="Lienholders"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
    }
    throw err;
  }

  return <LienholdersClient lienholders={lienholders} />;
}
