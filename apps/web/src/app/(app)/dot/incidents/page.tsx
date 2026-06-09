/**
 * /dot/incidents — Accident / incident register per 49 CFR 390.15.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { DotDriverDqViewDto, DotIncidentReportDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { IncidentsClient } from './incidents-client';

export const metadata = { title: 'Incidents — DOT Compliance — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function IncidentsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const [incidentsResult, dqResult] = await Promise.all([
    tryFetch(() =>
      apiServer<DotIncidentReportDto[]>('/dot/incidents', { accessToken: token ?? null }),
    ),
    tryFetch(() =>
      apiServer<DotDriverDqViewDto[]>('/dot/drivers/dq', { accessToken: token ?? null }),
    ),
  ]);

  if (incidentsResult.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Incidents</h1>
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

  return <IncidentsClient incidents={incidentsResult.data ?? []} drivers={dqResult.data ?? []} />;
}
