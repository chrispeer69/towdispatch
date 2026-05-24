/**
 * /repo/lienholders — lienholder book for the repossession workflow.
 *
 * Server-fetches the full lienholder roster and hands it to the client CRUD
 * surface. Roles the API gates out get a 403 explainer.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienholderDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { LienholdersClient } from './lienholders-client';

export const metadata = { title: 'Lienholders — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function LienholdersPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<LienholderDto[]>('/lienholders', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Lienholders</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the repossession workflow. Ask an owner or admin to
          extend your permissions.
        </p>
        <p className="mt-3">
          <Link href="/repo/cases" className="text-accent-orange">
            ← Back to repo cases
          </Link>
        </p>
      </section>
    );
  }

  return <LienholdersClient lienholders={result.data ?? []} />;
}
