import { Button } from '@/components/ui/button';
import { fetchDrivers } from '@/lib/api/fleet';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import type { PaginatedDrivers } from '@ustowdispatch/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { DriverListClient } from './driver-list-client';

export const dynamic = 'force-dynamic';

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
  const params = await searchParams;
  // Session 9.8 fix: read token at the page render site and thread through.
  // See BUILD_DECISIONS.md Session 9.7.
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  const result = await fetchDrivers({
    q: params.q,
    employmentStatus: params.employmentStatus,
    cdlClass: params.cdlClass,
    perPage: '50',
  }, token);
  const initial = result ?? EMPTY_DRIVERS;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-text-secondary-on-dark">
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
