import { Button } from '@/components/ui/button';
import { fetchTrucks } from '@/lib/api/fleet';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import type { PaginatedTrucks } from '@ustowdispatch/shared';
import { cookies } from 'next/headers';
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
  // Session 9.8 fix: read token at the page render site and thread through.
  // See BUILD_DECISIONS.md Session 9.7.
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  const result = await fetchTrucks({
    q: params.q,
    status: params.status,
    capacityClass: params.capacityClass,
    equipment: params.equipment,
    perPage: '50',
  }, token);
  const initial = result ?? EMPTY_TRUCKS;
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
