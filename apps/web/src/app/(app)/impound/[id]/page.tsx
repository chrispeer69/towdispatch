/**
 * /impound/[id] — record detail: vehicle + yard, holds, fee ledger,
 * release workflow, and state-form stub links. Server-fetches the full
 * detail aggregate; the client owns the mutations.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { ImpoundRecordDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { ImpoundDetailClient } from './detail-client';

export const metadata = { title: 'Impound record — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function ImpoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<ImpoundRecordDetailDto>(`/impound/records/${id}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Impound record</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to this record.
        </p>
        <p className="mt-3">
          <Link href="/impound" className="text-accent-orange">
            ← Back to impound
          </Link>
        </p>
      </section>
    );
  }
  if (result.error?.status === 404 || !result.data) {
    notFound();
  }

  return <ImpoundDetailClient detail={result.data} />;
}
