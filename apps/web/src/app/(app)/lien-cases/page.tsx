/**
 * /lien-cases — list page for the statutory lien-sale workflow.
 *
 * Server-fetches the case roster (optionally filtered) and hands it to the
 * client list. AUDITOR is read-only; MANAGER / ACCOUNTING / DRIVER get a 403
 * explainer (same RBAC as impound).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienCaseDto, LienCaseStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { LienCaseListClient } from './list-client';

export const metadata = { title: 'Lien Cases — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const KNOWN_STATUSES: LienCaseStatus[] = ['open', 'ready_for_sale', 'sold', 'closed', 'canceled'];

interface SearchParams {
  status?: LienCaseStatus;
  state?: string;
  dueSoon?: string;
}

export default async function LienCasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const statusFilter =
    params.status && KNOWN_STATUSES.includes(params.status) ? params.status : null;
  const token = await getSessionToken();

  const qs = new URLSearchParams();
  if (statusFilter) qs.set('status', statusFilter);
  if (params.state) qs.set('state', params.state);
  if (params.dueSoon === 'true') qs.set('dueSoon', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const result = await tryFetch(() =>
    apiServer<LienCaseDto[]>(`/lien-cases${suffix}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Lien Cases</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to lien processing. Ask an owner or admin to extend your
          permissions.
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
    <LienCaseListClient
      cases={result.data ?? []}
      status={statusFilter}
      state={params.state ?? null}
      dueSoon={params.dueSoon === 'true'}
    />
  );
}
