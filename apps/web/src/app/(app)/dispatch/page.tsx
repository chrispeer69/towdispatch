/**
 * Dispatch board page — Session 5.
 *
 * Server-renders a snapshot of queue / active / recently-completed / roster
 * via the API, then hands off to DispatchClient which opens a Socket.IO
 * connection for live updates and dnd-kit-driven drag-and-drop assignment.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { DriverRosterRow, JobDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { DispatchClient } from './dispatch-client';

export const metadata = { title: 'Dispatch — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

interface BoardResponse {
  queue: JobDto[];
  active: JobDto[];
  recentlyCompleted: JobDto[];
  roster: DriverRosterRow[];
}

interface SearchParams {
  created?: string;
  /** 'pending' | 'skipped' — set by /intake on success to surface in the toast. */
  sms?: string;
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const createdJobNumber = params.created ?? null;
  const smsHint =
    params.sms === 'skipped' ? 'skipped' : params.sms === 'pending' ? 'pending' : null;

  // Auth is enforced by (app)/layout.tsx. tryFetch surfaces a per-feature
  // 401/403 as data so this page never races the layout's redirect.
  const result = await tryFetch(() => apiServer<BoardResponse>('/dispatch/board'));
  const snapshot: BoardResponse = result.data ?? {
    queue: [],
    active: [],
    recentlyCompleted: [],
    roster: [],
  };

  const tokenRaw = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null;
  const mapboxToken =
    tokenRaw && tokenRaw !== 'pk.placeholder' && !tokenRaw.startsWith('pk.placeholder')
      ? tokenRaw
      : null;

  return (
    <DispatchClient
      initialSnapshot={snapshot}
      mapboxToken={mapboxToken}
      createdJobNumber={createdJobNumber}
      smsHint={smsHint}
    />
  );
}
