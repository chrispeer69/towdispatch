import { Button } from '@/components/ui/button';
import { fetchDrivers } from '@/lib/api/fleet';
import Link from 'next/link';
import { DriverListClient } from './driver-list-client';

interface SearchParams {
  q?: string;
  employmentStatus?: string;
  cdlClass?: string;
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const initial = await fetchDrivers({
    q: params.q,
    employmentStatus: params.employmentStatus,
    cdlClass: params.cdlClass,
    perPage: '50',
  });
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
