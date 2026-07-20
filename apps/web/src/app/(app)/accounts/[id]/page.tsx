import { tryFetch } from '@/lib/api/client';
import { fetchAccount, fetchCustomers } from '@/lib/api/resources';
import type { PaginatedCustomers } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountForm } from '../account-form';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Account — US Tow Dispatch' };

const EMPTY_CUSTOMERS: PaginatedCustomers = { data: [], total: 0, page: 1, perPage: 100 };

export default async function AccountDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const [accountRes, linkedRes] = await Promise.all([
    tryFetch(() => fetchAccount(id)),
    tryFetch(() => fetchCustomers({ accountId: id, perPage: '100' })),
  ]);
  // Treat 401/403/404 on the primary resource the same: from the operator's
  // point of view the record is unreachable, so 404 instead of crashing the
  // shell or showing a confusing detail page with empty data.
  if (!accountRes.data) notFound();
  const account = accountRes.data;
  const linked = linkedRes.data ?? EMPTY_CUSTOMERS;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          <Link href="/accounts" className="hover:text-text-primary-on-dark">
            ← All accounts
          </Link>
        </p>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          {account.name}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          {account.billingTerms.replace('_', ' ')} - ${account.creditUsed} used
          {account.creditLimit ? ` / $${account.creditLimit} limit` : ' / no limit'}
          {account.isMotorClub
            ? ` - motor club (${account.motorClubNetworkCode ?? 'unknown'})`
            : ''}
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Customers under this account ({linked.total})
        </h2>
        {linked.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary-on-dark">
            No customers are billed to this account yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-divider overflow-hidden rounded-[10px] border border-divider">
            {linked.data.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between bg-bg-surface-elevated/30 px-3 py-2 text-sm"
              >
                <Link
                  href={`/customers/${c.id}`}
                  className="font-medium text-text-primary-on-dark hover:text-brand-primary"
                >
                  {c.name}
                </Link>
                <span className="font-mono text-[11px] text-text-secondary-on-dark-on-dark/60">
                  {c.phone ?? '—'} - {c.type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccountForm mode="edit" initial={account} />
    </div>
  );
}
