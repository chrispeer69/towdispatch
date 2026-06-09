/**
 * /dot/drug-alcohol — Drug & alcohol test log.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotDriverDqViewDto, DotDrugAlcoholTestDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { DrugAlcoholClient } from './drug-alcohol-client';

export const metadata = { title: 'Drug & Alcohol — DOT Compliance — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function DrugAlcoholPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const [testsResult, dqResult] = await Promise.all([
    tryFetch(() =>
      apiServer<DotDrugAlcoholTestDto[]>('/dot/drug-tests', { accessToken: token ?? null }),
    ),
    tryFetch(() =>
      apiServer<DotDriverDqViewDto[]>('/dot/drivers/dq', { accessToken: token ?? null }),
    ),
  ]);

  if (testsResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Drug &amp; Alcohol</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the DOT Compliance module. Ask an owner or admin to
          extend your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dot" className="text-accent-orange">
            ← Back to DOT Compliance
          </Link>
        </p>
      </section>
    );
  }

  return <DrugAlcoholClient tests={testsResult.data ?? []} drivers={dqResult.data ?? []} />;
}
