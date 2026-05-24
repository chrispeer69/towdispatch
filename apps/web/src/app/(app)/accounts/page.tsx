import { Button } from '@/components/ui/button';
import { fetchAccounts } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import Link from 'next/link';
import { AccountListClient } from './account-list-client';

export const metadata = { title: 'Accounts — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

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

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const isMotorClub = params.isMotorClub ?? (params.type === 'motor_club' ? 'true' : undefined);

  // Combine Session 9.7 cached layout read with Session 9.8 token threading.
  const token = await getSessionToken();
  const initial = await fetchAccounts(
    {
      q: params.q,
      active: params.active,
      isMotorClub,
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
            {isMotorClub === 'true' ? 'Motor Clubs' : 'Accounts'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
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
