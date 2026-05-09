import { fetchAccount, fetchCustomers } from '@/lib/api/resources';
import Link from 'next/link';
import { AccountForm } from '../account-form';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Account — TowCommand' };

export default async function AccountDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const [account, linked] = await Promise.all([
    fetchAccount(id),
    fetchCustomers({ accountId: id, perPage: '100' }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          <Link href="/accounts" className="hover:text-text-primary">
            ← All accounts
          </Link>
        </p>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          {account.name}
        </h1>
        <p className="text-sm text-text-secondary">
          {account.billingTerms.replace('_', ' ')} · ${account.creditUsed} used
          {account.creditLimit ? ` / $${account.creditLimit} limit` : ' / no limit'}
          {account.isMotorClub
            ? ` · motor club (${account.motorClubNetworkCode ?? 'unknown'})`
            : ''}
        </p>
      </header>

      <section className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Customers under this account ({linked.total})
        </h2>
        {linked.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">
            No customers are billed to this account yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-steel-border overflow-hidden rounded-[10px] border border-steel-border">
            {linked.data.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between bg-steel-light/30 px-3 py-2 text-sm"
              >
                <Link
                  href={`/customers/${c.id}`}
                  className="font-medium text-text-primary hover:text-orange-light"
                >
                  {c.name}
                </Link>
                <span className="font-mono text-[11px] text-text-muted">
                  {c.phone ?? '—'} · {c.type}
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
