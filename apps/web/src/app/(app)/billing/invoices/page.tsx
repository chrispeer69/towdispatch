import { fetchInvoices, formatMoneyCents } from '@/lib/api/billing';
import { invoiceStatusLabel, invoiceStatusValues } from '@ustowdispatch/shared';
import Link from 'next/link';

export const metadata = { title: 'Invoices â€” US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  // [diag-list-empty] Temporary: unwrap tryFetch so any 4xx throws into
  // (app)/error.tsx instead of silently rendering an empty list. Restore the
  // tryFetch wrapper once the list-pages-empty triage closes.
  const list = await fetchInvoices({
    status: params.status,
    search: params.search,
    limit: params.limit ?? '50',
    offset: params.offset ?? '0',
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            <span data-testid="invoice-count">{list.total}</span> total
          </p>
        </div>
        <Link
          href="/billing/invoices/new"
          className="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary-hover"
        >
          + New invoice
        </Link>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-divider bg-bg-surface/40 p-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Status
          <select
            name="status"
            defaultValue={params.status ?? ''}
            className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {invoiceStatusValues.map((s) => (
              <option key={s} value={s}>
                {invoiceStatusLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
          Search
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ''}
            placeholder="invoice # or notesâ€¦"
            className="rounded border border-divider bg-bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
        >
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm" data-testid="invoice-table">
          <thead className="bg-bg-surface/60">
            <tr className="text-left">
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Invoice #
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Status
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Type
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Issued
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Due
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Total
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Balance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {list.data.map((inv) => (
              <tr key={inv.id} className="hover:bg-bg-surface/30">
                <td className="px-4 py-2 font-mono text-sm">
                  <Link
                    href={`/billing/invoices/${inv.id}`}
                    className="text-brand-primary hover:underline"
                    data-testid={`invoice-row-${inv.invoiceNumber}`}
                  >
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs uppercase tracking-wider"
                    data-testid={`invoice-status-${inv.id}`}
                  >
                    {invoiceStatusLabel[inv.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-text-secondary-on-dark">{inv.invoiceType}</td>
                <td className="px-4 py-2 text-text-secondary-on-dark">
                  {inv.issuedAt ? inv.issuedAt.slice(0, 10) : 'â€”'}
                </td>
                <td className="px-4 py-2 text-text-secondary-on-dark">
                  {inv.dueAt ? inv.dueAt.slice(0, 10) : 'â€”'}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(inv.totalCents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(inv.balanceCents)}
                </td>
              </tr>
            ))}
            {list.data.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-12 text-center text-text-secondary-on-dark-on-dark/60"
                  colSpan={7}
                >
                  No invoices match the filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
