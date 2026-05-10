/**
 * Dispatch board page — Session 5.
 *
 * Server-renders a snapshot of queue / active / recently-completed / roster
 * via the API, then hands off to DispatchClient which opens a Socket.IO
 * connection for live updates and dnd-kit-driven drag-and-drop assignment.
 */
import { ApiError, apiServer } from '@/lib/api/client';
import { requireUser } from '@/lib/auth/session';
import type { DriverRosterRow, JobDto } from '@towcommand/shared';
import type { JSX } from 'react';
import { DispatchClient } from './dispatch-client';

export const metadata = { title: 'Dispatch — TowCommand' };
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
  await requireUser();
  const params = await searchParams;
  const createdJobNumber = params.created ?? null;
  const smsHint =
    params.sms === 'skipped' ? 'skipped' : params.sms === 'pending' ? 'pending' : null;

  let snapshot: BoardResponse = {
    queue: [],
    active: [],
    recentlyCompleted: [],
    roster: [],
  };

  try {
    snapshot = await apiServer<BoardResponse>('/dispatch/board');
  } catch (err) {
    // 401 escalates via apiServer → handled by requireUser on next render.
    if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) {
      throw err;
    }
  }

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
