/**
 * /repo/cases/new — open a new repossession case against a lienholder.
 *
 * Server-fetches the active lienholder book and hands it to the intake form.
 * The repo module ships dark behind the API's REPO_MODULE_ENABLED flag (503
 * when off); roles the API gates out get 403. Both render a calm explainer
 * instead of crashing the route.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienholderDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { RepoUnavailable } from '../../repo-unavailable';
import { NewRepoCaseClient } from './new-client';

export const metadata = { title: 'New Repo Case — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function NewRepoCasePage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  let lienholders: LienholderDto[];
  try {
    lienholders = await apiServer<LienholderDto[]>('/lienholders?active=true', {
      accessToken: token ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'repo_module_disabled' || err.status === 503) {
        return (
          <RepoUnavailable
            kind="disabled"
            title="New Repo Case"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
      if (err.status === 403) {
        return (
          <RepoUnavailable
            kind="forbidden"
            title="New Repo Case"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
    }
    throw err;
  }

  return <NewRepoCaseClient lienholders={lienholders} />;
}
