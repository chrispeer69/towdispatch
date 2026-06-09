/**
 * /repo/cases/[id] — detail page. Server-fetches the case aggregate (case +
 * lienholder + attempts + recovery events + personal property + condition
 * photos) and hands it to the client component that owns the operator actions.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { RepoCaseDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
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
  const result = await tryFetch(() =>
    apiServer<RepoCaseDetailDto>(`/repo-cases/${id}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Repo Case</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the repossession workflow.
        </p>
        <p className="mt-3">
          <Link href="/repo/cases" className="text-accent-orange">
            ← Back to repo cases
          </Link>
        </p>
      </section>
    );
  }
  if (result.error || !result.data) notFound();

  return <RepoCaseDetailClient detail={result.data} />;
}
