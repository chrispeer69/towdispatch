import { Button } from '@/components/ui/button';
import { fetchCustomers } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import type { CustomerType } from '@ustowdispatch/shared';
import Link from 'next/link';
import { CustomerListClient } from './customer-list-client';

export const metadata = { title: 'Customers — US Tow DISPATCH' };
// Same posture as /jobs and /dashboard — never prerender, never cache. async
// searchParams already opts this page into dynamic, but stating it explicitly
// keeps the entire (app)/ list-page surface uniform and rules out any future
// path where Next.js decides to cache an unauthenticated empty render.
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  type?: string;
  page?: string;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  // Combine Session 9.7 cached layout read with Session 9.8 token threading.
  const token = await getSessionToken();
  // [diag-list-empty] Temporary: unwrap tryFetch so any 4xx throws into
  // (app)/error.tsx instead of silently rendering an empty list. Restore the
  // tryFetch wrapper once the list-pages-empty triage closes.
  const initial = await fetchCustomers(
    {
      q: params.q,
      type: params.type,
      page: params.page,
      perPage: '50',
    },
    token,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Customers
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            <span data-testid="customer-count">{initial.total}</span> total Â· who you serve
          </p>
        </div>
        <Link href="/customers/new">
          <Button>+ New customer</Button>
        </Link>
      </header>

      <CustomerListClient
        initial={initial}
        initialQ={params.q ?? ''}
        initialType={(params.type as CustomerType | undefined) ?? null}
      />
    </div>
  );
}
