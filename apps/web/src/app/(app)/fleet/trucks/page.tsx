import { Button } from '@/components/ui/button';
import { fetchTrucks } from '@/lib/api/fleet';
import Link from 'next/link';
import { TruckListClient } from './truck-list-client';

interface SearchParams {
  q?: string;
  status?: string;
  capacityClass?: string;
  equipment?: string;
}

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const initial = await fetchTrucks({
    q: params.q,
    status: params.status,
    capacityClass: params.capacityClass,
    equipment: params.equipment,
    perPage: '50',
  });
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
