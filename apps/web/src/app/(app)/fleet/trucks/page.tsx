import { Button } from '@/components/ui/button';
import { tryFetch } from '@/lib/api/client';
import { fetchTrucks } from '@/lib/api/fleet';
import { getRequestId } from '@/lib/debug/redirect-trace';
import type { PaginatedTrucks } from '@towcommand/shared';
import Link from 'next/link';
import { TruckListClient } from './truck-list-client';

interface SearchParams {
  q?: string;
  status?: string;
  capacityClass?: string;
  equipment?: string;
}

const EMPTY_TRUCKS: PaginatedTrucks = { data: [], total: 0, page: 1, perPage: 50 };

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  // [FLEET_DEBUG_V2]
  const rid = getRequestId();
  // eslint-disable-next-line no-console
  console.error(`[FLEET_DEBUG_V2 rid=${rid}] fleet/trucks/page enter`);
  const params = await searchParams;
  const result = await tryFetch(() =>
    fetchTrucks({
      q: params.q,
      status: params.status,
      capacityClass: params.capacityClass,
      equipment: params.equipment,
      perPage: '50',
    }),
  );
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG_V2 rid=${rid}] fleet/trucks/page tryFetch=${result.data ? `ok total=${result.data.total}` : `err status=${result.error?.status} code=${result.error?.code} msg=${result.error?.message}`}`,
  );
  const initial = result.data ?? EMPTY_TRUCKS;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-text-secondary">
          <span data-testid="truck-count">{initial.total}</span> trucks
        </p>
        <Link href="/fleet/trucks/new">
          <Button>+ New truck</Button>
        </Link>
      </div>
      <TruckListClient initial={initial} initialQuery={params} />
    </div>
  );
}
