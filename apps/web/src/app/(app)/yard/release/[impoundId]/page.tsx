/**
 * /yard/release/[impoundId] — the gated release wizard. Server-fetches the
 * live workflow (if any); the client drives the 4 steps. The wizard is
 * status-driven (the workflow row is the source of truth), so a reload / back
 * button always resumes at the true current step — retry-safe by construction.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { ReleaseWorkflowDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { ReleaseWizardClient } from './release-wizard-client';

export const metadata = { title: 'Vehicle Release — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function ReleasePage({
  params,
}: {
  params: Promise<{ impoundId: string }>;
}): Promise<JSX.Element> {
  const { impoundId } = await params;
  const token = await getSessionToken();
  const wf = await tryFetch(() =>
    apiServer<ReleaseWorkflowDto | null>(`/yard/release/${impoundId}`, {
      accessToken: token ?? null,
    }),
  );
  if (wf.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Vehicle Release</h1>
        <p className="text-text-secondary-on-dark">No access to yard management.</p>
        <Link href="/yard/gate-search" className="mt-3 block text-accent-orange">
          ← Gate search
        </Link>
      </section>
    );
  }
  return <ReleaseWizardClient impoundId={impoundId} initial={wf.data ?? null} />;
}
