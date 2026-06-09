/**
 * /repo/cases/new — open a new repossession case against a lienholder.
 *
 * Server-fetches the active lienholder book and hands it to the intake form.
 * Roles the API gates out get a 403 explainer.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { LienholderDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { NewRepoCaseClient } from './new-client';

export const metadata = { title: 'New Repo Case — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function NewRepoCasePage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<LienholderDto[]>('/lienholders?active=true', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">New Repo Case</h1>
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

  return <NewRepoCaseClient lienholders={result.data ?? []} />;
}
