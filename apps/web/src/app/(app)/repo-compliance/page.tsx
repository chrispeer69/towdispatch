/**
 * /repo-compliance — state-by-state repossession compliance reference.
 *
 * Server-fetches the per-state rule set and hands it to the client reference
 * tool: a rule browser, a breach-of-peace checklist, and a personal-property
 * hold calculator. Read access mirrors the lien module (OWNER / ADMIN /
 * DISPATCHER / AUDITOR); other roles get a 403 explainer.
 *
 * NOTE (S49): this is the compliance reference surface. The case-bound view
 * (apps/web/.../repo/cases/[id]) lands when the S49 RepoCaseService ships and
 * produces real repo cases — see SESSION_50_DECISIONS.md D4.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { RepoStateRulesDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { RepoComplianceReferenceClient } from './reference-client';

export const metadata = { title: 'Repo Compliance — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function RepoCompliancePage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<RepoStateRulesDto[]>('/repo-compliance/state-rules', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Repo Compliance</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to repossession compliance. Ask an owner or admin to extend
          your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  return <RepoComplianceReferenceClient rules={result.data ?? []} />;
}
