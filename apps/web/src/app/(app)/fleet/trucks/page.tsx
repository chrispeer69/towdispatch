import { Button } from '@/components/ui/button';
import { tryFetch } from '@/lib/api/client';
import { fetchTrucks } from '@/lib/api/fleet';
import type { PaginatedTrucks } from '@ustowdispatch/shared';
import Link from 'next/link';
import { TruckListClient } from './truck-list-client';

export const dynamic = 'force-dynamic';

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
  const initial = result.data ?? EMPTY_TRUCKS;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-text-secondary-on-dark">
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
