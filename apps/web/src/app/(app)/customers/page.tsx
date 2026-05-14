import { Button } from '@/components/ui/button';
import { tryFetch } from '@/lib/api/client';
import { fetchCustomers } from '@/lib/api/resources';
import type { CustomerType, PaginatedCustomers } from '@ustowdispatch/shared';
import Link from 'next/link';
import { CustomerListClient } from './customer-list-client';

export const metadata = { title: 'Customers — US Tow DISPATCH' };

interface SearchParams {
  q?: string;
  type?: string;
  page?: string;
}

const EMPTY_CUSTOMERS: PaginatedCustomers = { data: [], total: 0, page: 1, perPage: 50 };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const result = await tryFetch(() =>
    fetchCustomers({
      q: params.q,
      type: params.type,
      page: params.page,
      perPage: '50',
    }),
  );
  const initial = result.data ?? EMPTY_CUSTOMERS;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Customers
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span data-testid="customer-count">{initial.total}</span> total · who you serve
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
