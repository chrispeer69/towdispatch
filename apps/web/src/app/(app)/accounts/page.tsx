import { Button } from '@/components/ui/button';
import { tryFetch } from '@/lib/api/client';
import { fetchAccounts } from '@/lib/api/resources';
import type { PaginatedAccounts } from '@ustowdispatch/shared';
import Link from 'next/link';
import { AccountListClient } from './account-list-client';

export const metadata = { title: 'Accounts â€” US Tow DISPATCH' };

interface SearchParams {
  q?: string;
  active?: string;
  isMotorClub?: string;
  /**
   * The Motor Clubs sidebar entry deep-links here as ?type=motor_club so we
   * can show the same /accounts page filtered. Translate to isMotorClub.
   */
  type?: string;
  page?: string;
}

const EMPTY_ACCOUNTS: PaginatedAccounts = { data: [], total: 0, page: 1, perPage: 50 };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const isMotorClub = params.isMotorClub ?? (params.type === 'motor_club' ? 'true' : undefined);

  const result = await tryFetch(() =>
    fetchAccounts({
      q: params.q,
      active: params.active,
      isMotorClub,
      page: params.page,
      perPage: '50',
    }),
  );
  const initial = result.data ?? EMPTY_ACCOUNTS;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            {isMotorClub === 'true' ? 'Motor Clubs' : 'Accounts'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span data-testid="account-count">{initial.total}</span> total Â·{' '}
            {isMotorClub === 'true'
              ? 'AAA, Agero, and friends'
              : 'commercial billing relationships'}
          </p>
        </div>
        <Link href="/accounts/new">
          <Button>+ New account</Button>
        </Link>
      </header>

      <AccountListClient
        initial={initial}
        initialQ={params.q ?? ''}
        initialIsMotorClub={isMotorClub === 'true' ? true : isMotorClub === 'false' ? false : null}
      />
    </div>
  );
}
