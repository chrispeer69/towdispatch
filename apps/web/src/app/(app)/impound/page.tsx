/**
 * /impound — list page for the Impound & Storage yard.
 *
 * Server-fetches the record roster + yards (for the filter dropdown) and
 * hands them to the client list. AUDITOR is read-only; MANAGER /
 * ACCOUNTING / DRIVER get a 403 explainer.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { ImpoundRecordDto, ImpoundRecordStatus, ImpoundYardDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { ImpoundListClient } from './list-client';

export const metadata = { title: 'Impound & Storage — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const KNOWN_STATUSES: ImpoundRecordStatus[] = [
  'stored',
  'pending_release',
  'released',
  'transferred',
  'disposed',
];

interface SearchParams {
  status?: ImpoundRecordStatus;
  yardId?: string;
  lienEligible?: string;
}

export default async function ImpoundListPage({
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
  if (params.yardId) qs.set('yardId', params.yardId);
  if (params.lienEligible === 'true') qs.set('lienEligible', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const recordsResult = await tryFetch(() =>
    apiServer<ImpoundRecordDto[]>(`/impound/records${suffix}`, { accessToken: token ?? null }),
  );

  if (recordsResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Impound &amp; Storage</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the impound yard. Ask an owner or admin to extend your
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

  const yardsResult = await tryFetch(() =>
    apiServer<ImpoundYardDto[]>('/impound/yards', { accessToken: token ?? null }),
  );

  return (
    <ImpoundListClient
      records={recordsResult.data ?? []}
      yards={yardsResult.data ?? []}
      status={statusFilter}
      yardId={params.yardId ?? null}
      lienOnly={params.lienEligible === 'true'}
    />
  );
}
