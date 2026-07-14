/**
 * /settings/capacity/broadcasts — CADS broadcast log. Every outbound
 * delivery attempt with its receipt, so "you said you were available"
 * disputes can be settled from the record. Filterable by partner and
 * status, paginated; row expand shows the exact JSON payload sent.
 *
 * Nested under /settings/capacity so the Capacity Signaling tab stays
 * highlighted (the settings sidebar matches on href prefix).
 */
import { fetchCapacityBroadcasts, fetchCapacityPartners } from '@/lib/api/capacity';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { CapacityBroadcastPage, CapacityPartnerDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { BroadcastLogClient } from './broadcast-log-client';

export const metadata = { title: 'Capacity Broadcast Log — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const EMPTY_PAGE: CapacityBroadcastPage = { items: [], page: 1, perPage: 25, total: 0 };

export default async function CapacityBroadcastsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const [pageR, partnersR] = await Promise.all([
    tryFetch(() => fetchCapacityBroadcasts({ page: 1, perPage: 25 }, token)),
    tryFetch(() => fetchCapacityPartners(token)),
  ]);
  const initialPage: CapacityBroadcastPage = pageR.data ?? EMPTY_PAGE;
  const partners: CapacityPartnerDto[] = partnersR.data ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          Broadcast Log
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Every capacity-signal delivery attempt, with receipt, latency, and payload.{' '}
          <Link href="/settings/capacity" className="text-brand-primary hover:underline">
            Back to Capacity Signaling
          </Link>
        </p>
      </header>
      <BroadcastLogClient initialPage={initialPage} partners={partners} />
    </div>
  );
}
