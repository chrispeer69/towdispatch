import { Button } from '@/components/ui/button';
import { tryFetch } from '@/lib/api/client';
import { fetchDrivers } from '@/lib/api/fleet';
import type { PaginatedDrivers } from '@towcommand/shared';
import Link from 'next/link';
import { DriverListClient } from './driver-list-client';

interface SearchParams {
  q?: string;
  employmentStatus?: string;
  cdlClass?: string;
}

const EMPTY_DRIVERS: PaginatedDrivers = { data: [], total: 0, page: 1, perPage: 50 };

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  // [FLEET_DEBUG] — temporary diagnostic. Revert after the fleet bounce is fixed.
  // eslint-disable-next-line no-console
  console.error('[FLEET_DEBUG] fleet/drivers/page enter');
  const params = await searchParams;
  const result = await tryFetch(() =>
    fetchDrivers({
      q: params.q,
      employmentStatus: params.employmentStatus,
      cdlClass: params.cdlClass,
      perPage: '50',
    }),
  );
  // eslint-disable-next-line no-console
  console.error(
    `[FLEET_DEBUG] fleet/drivers/page tryFetch=${result.data ? `ok total=${result.data.total}` : `err status=${result.error?.status} code=${result.error?.code}`}`,
  );
  const initial = result.data ?? EMPTY_DRIVERS;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-text-secondary">
          <span data-testid="driver-count">{initial.total}</span> drivers
        </p>
        <Link href="/fleet/drivers/new">
          <Button>+ New driver</Button>
        </Link>
      </div>
      <DriverListClient initial={initial} initialQuery={params} />
    </div>
  );
}
