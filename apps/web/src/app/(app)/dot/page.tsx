/**
 * /dot — DOT Compliance hub page.
 *
 * Server-fetches the carrier profile and renders a nav-card grid plus
 * the audit-packet generator. AUDITOR is read-only; other roles without
 * access get the 403 explainer block (matches the impound page pattern).
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotCarrierProfileDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { DotHubClient } from './dot-hub-client';

export const metadata = { title: 'DOT Compliance — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function DotHubPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const profileResult = await tryFetch(() =>
    apiServer<DotCarrierProfileDto | null>('/dot/carrier-profile', { accessToken: token ?? null }),
  );

  if (profileResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">DOT Compliance</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the DOT Compliance module. Ask an owner or admin to
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

  return <DotHubClient profile={profileResult.data ?? null} />;
}
