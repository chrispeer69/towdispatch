/**
 * /lien-cases/[id] — detail page. Server-fetches the case aggregate (case +
 * impound summary + notices + timeline + computed next action) and hands it
 * to the client component that owns the operator actions.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienCaseDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { LienCaseDetailClient } from './detail-client';

export const metadata = { title: 'Lien Case — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function LienCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<LienCaseDetailDto>(`/lien-cases/${id}`, { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Lien Case</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to lien processing.
        </p>
        <p className="mt-3">
          <Link href="/lien-cases" className="text-accent-orange">
            ← Back to lien cases
          </Link>
        </p>
      </section>
    );
  }
  if (result.error || !result.data) notFound();

  return <LienCaseDetailClient detail={result.data} />;
}
