/**
 * /yard/facilities — facility roster + CRUD (Yard Management, Session 54).
 * Server-fetches the list; AUDITOR is read-only, unsupported roles get a 403
 * explainer (same RBAC as impound).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { YardFacilityDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { FacilitiesClient } from './facilities-client';

export const metadata = { title: 'Yard Facilities — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function YardFacilitiesPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<YardFacilityDto[]>('/yard/facilities', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Yard Facilities</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to yard management. Ask an owner or admin to extend your
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

  return <FacilitiesClient initial={result.data ?? []} />;
}
