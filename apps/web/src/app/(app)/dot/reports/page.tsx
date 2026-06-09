/**
 * /dot/reports — DOT compliance reports: HOS violations, DQ deficiencies,
 * open DVIR defects.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type {
  DotDriverDqViewDto,
  DotHosViolationReportRow,
  DotOpenDvirDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { ReportsClient } from './reports-client';

export const metadata = { title: 'Reports — DOT Compliance — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const [hosResult, dqResult, dvirResult] = await Promise.all([
    tryFetch(() =>
      apiServer<DotHosViolationReportRow[]>('/dot/reports/hos-violations?days=90', {
        accessToken: token ?? null,
      }),
    ),
    tryFetch(() =>
      apiServer<DotDriverDqViewDto[]>('/dot/reports/dq-deficiencies', {
        accessToken: token ?? null,
      }),
    ),
    tryFetch(() =>
      apiServer<DotOpenDvirDto[]>('/dot/reports/open-dvirs', { accessToken: token ?? null }),
    ),
  ]);

  if (hosResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">DOT Reports</h1>
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

  return (
    <ReportsClient
      hosViolations={hosResult.data ?? []}
      dqDeficiencies={dqResult.data ?? []}
      openDvirs={dvirResult.data ?? []}
    />
  );
}
