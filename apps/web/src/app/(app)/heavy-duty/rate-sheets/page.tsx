/**
 * /heavy-duty/rate-sheets — tenant HD rate-card editor. Server-fetches the
 * current sheets; the client handles create / edit / delete.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { HdRateSheetDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { RateSheetsClient } from './rate-sheets-client';

export const metadata = { title: 'HD Rate Sheets — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function HdRateSheetsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<HdRateSheetDto[]>('/heavy-duty/rate-sheets', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">HD Rate Sheets</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to heavy-duty rate sheets.
        </p>
        <p className="mt-3">
          <Link href="/heavy-duty" className="text-accent-orange">
            ← Back to heavy-duty
          </Link>
        </p>
      </section>
    );
  }

  return <RateSheetsClient initial={result.data ?? []} />;
}
