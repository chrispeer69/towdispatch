import { tryFetch } from '@/lib/api/client';
import { fetchAccounts } from '@/lib/api/resources';
import type { PaginatedAccounts } from '@towcommand/shared';

export const metadata = { title: 'Statements — TowCommand' };

const EMPTY_ACCOUNTS: PaginatedAccounts = { data: [], total: 0, page: 1, perPage: 100 };

export default async function StatementsPage(): Promise<JSX.Element> {
  const result = await tryFetch(() => fetchAccounts({ perPage: '100' }));
  const accounts = result.data ?? EMPTY_ACCOUNTS;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Statements
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Generate a statement of account PDF for any account with open invoices.
        </p>
      </header>
      <ul className="divide-y divide-steel-border rounded-lg border border-steel-border">
        {accounts.data.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            data-testid={`account-row-${a.id}`}
          >
            <div>
              <p className="font-medium">{a.name}</p>
              <p className="text-text-secondary">{a.billingTerms}</p>
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/billing/statements/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-steel-light px-3 py-1.5 text-sm hover:bg-steel-border"
              >
                PDF
              </a>
            </div>
          </li>
        ))}
        {accounts.data.length === 0 ? (
          <li className="px-4 py-6 text-center text-text-muted">No accounts.</li>
        ) : null}
      </ul>
    </div>
  );
}
