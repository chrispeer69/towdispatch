/**
 * /lien-cases/new — open a lien case against a lien-eligible impound record.
 *
 * Server-fetches the lien-eligible impound roster (read-only consumption of
 * the impound API — the impound module is NOT modified by this session) and
 * hands it to the open form. An optional ?impoundRecordId= preselects the
 * record, which is how an operator arrives from an impound record.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { ImpoundRecordDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { OpenLienCaseClient } from './open-client';

export const metadata = { title: 'Open Lien Case — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function NewLienCasePage({
  searchParams,
}: {
  searchParams: Promise<{ impoundRecordId?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<ImpoundRecordDto[]>('/impound/records?lienEligible=true', {
      accessToken: token ?? null,
    }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Open Lien Case</h1>
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

  return (
    <OpenLienCaseClient
      records={result.data ?? []}
      preselectRecordId={params.impoundRecordId ?? null}
    />
  );
}
