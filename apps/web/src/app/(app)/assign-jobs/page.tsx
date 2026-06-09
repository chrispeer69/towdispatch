/**
 * Assign Jobs — the drag-to-assign surface. Server-renders the same dispatch
 * board snapshot the live page uses, then hands off to the client which opens
 * a socket and shows the New queue on the left and Driver roster on the right.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { DriverRosterRow, JobDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { AssignJobsClient } from './assign-jobs-client';

export const metadata = { title: 'Assign Jobs — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

interface BoardResponse {
  queue: JobDto[];
  active: JobDto[];
  recentlyCompleted: JobDto[];
  roster: DriverRosterRow[];
}

export default async function AssignJobsPage(): Promise<JSX.Element> {
  const result = await tryFetch(() => apiServer<BoardResponse>('/dispatch/board'));
  const snapshot: BoardResponse = result.data ?? {
    queue: [],
    active: [],
    recentlyCompleted: [],
    roster: [],
  };

  return <AssignJobsClient initialSnapshot={snapshot} />;
}
