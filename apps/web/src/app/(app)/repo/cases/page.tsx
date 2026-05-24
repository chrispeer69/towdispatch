/**
 * /repo/cases — list page for the repossession workflow.
 *
 * Server-fetches the case roster (optionally filtered by status + lienholder)
 * and hands it to the client list. Roles the API gates out get a 403 explainer
 * (same RBAC posture as lien processing).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { RepoCaseDto, RepoCaseStatus } from '@ustowdispatch/shared';
import { repoCaseStatusValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { RepoCaseListClient } from './list-client';

export const metadata = { title: 'Repo Cases — US Tow DISPATCH' };
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

  const result = await tryFetch(() =>
    apiServer<RepoCaseDto[]>(`/repo-cases${suffix}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Repo Cases</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the repossession workflow. Ask an owner or admin to
          extend your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  return (
    <RepoCaseListClient
      cases={result.data ?? []}
      status={statusFilter}
      lienholderId={lienholderId}
    />
  );
}
