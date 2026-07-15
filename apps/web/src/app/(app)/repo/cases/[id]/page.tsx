/**
 * /repo/cases/[id] — detail page. Server-fetches the case aggregate (case +
 * lienholder + attempts + recovery events + personal property + condition
 * photos) and hands it to the client component that owns the operator actions.
 *
 * The repo module ships dark behind the API's REPO_MODULE_ENABLED flag (503
 * when off); roles the API gates out get 403; an unknown case id 404s. All
 * render a calm explainer / not-found instead of crashing the route.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { RepoCaseDetailDto } from '@ustowdispatch/shared';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { RepoUnavailable } from '../../repo-unavailable';
import { RepoCaseDetailClient } from './detail-client';

export const metadata = { title: 'Repo Case — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function RepoCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();

  let detail: RepoCaseDetailDto;
  try {
    detail = await apiServer<RepoCaseDetailDto>(`/repo-cases/${id}`, {
      accessToken: token ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'repo_module_disabled' || err.status === 503) {
        return (
          <RepoUnavailable
            kind="disabled"
            title="Repo Case"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
      if (err.status === 403) {
        return (
          <RepoUnavailable
            kind="forbidden"
            title="Repo Case"
            backHref="/repo/cases"
            backLabel="← Back to repo cases"
          />
        );
      }
      if (err.status === 404) notFound();
    }
    throw err;
  }

  return <RepoCaseDetailClient detail={detail} />;
}
