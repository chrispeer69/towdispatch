import { Button } from '@/components/ui/button';
import { fetchCustomers } from '@/lib/api/resources';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import type { CustomerType } from '@ustowdispatch/shared';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { CustomerListClient } from './customer-list-client';

export const metadata = { title: 'Customers â€” US Tow DISPATCH' };
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
  // Session 9.7 fix: Next.js 15 production builds lose the cookies() request
  // scope between the (app)/layout.tsx requireUser() call and the page render
  // — same request, two cookies() calls, the second returns an empty store.
  // Read directly from the cookie request header instead. See
  // BUILD_DECISIONS.md Session 9.7.
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const token =
    cookieHeader
      .split(/;\s*/)
      .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
      ?.slice(ACCESS_COOKIE.length + 1) ?? null;
  // [diag-page-cookies] Temporary: confirm headers()-based read sees the cookie
  // when the page-level cookies() call does not. Remove once Session 9.7 closes.
  // eslint-disable-next-line no-console
  console.log('[diag-page-cookies]', {
    hasToken: Boolean(token),
    cookieNames: (await cookies()).getAll().map((c) => c.name),
    headerHasCookie: cookieHeader.length > 0,
  });
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
