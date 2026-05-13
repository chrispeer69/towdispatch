import { type InvoiceListResponse, fetchInvoices, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { invoiceStatusLabel, invoiceStatusValues } from '@towcommand/shared';
import Link from 'next/link';

export const metadata = { title: 'Invoices — TowCommand' };

interface SearchParams {
  status?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

const EMPTY_INVOICES: InvoiceListResponse = { data: [], total: 0, limit: 50, offset: 0 };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const result = await tryFetch(() =>
    fetchInvoices({
      status: params.status,
      search: params.search,
      limit: params.limit ?? '50',
      offset: params.offset ?? '0',
    }),
  );
  const list = result.data ?? EMPTY_INVOICES;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span data-testid="invoice-count">{list.total}</span> total
          </p>
        </div>
        <Link
          href="/billing/invoices/new"
          className="rounded-md bg-orange px-4 py-2 text-sm font-medium text-white hover:bg-orange-light"
        >
          + New invoice
        </Link>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-steel-border bg-steel-mid/40 p-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Status
          <select
            name="status"
            defaultValue={params.status ?? ''}
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {invoiceStatusValues.map((s) => (
              <option key={s} value={s}>
                {invoiceStatusLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-text-muted">
          Search
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ''}
            placeholder="invoice # or notes…"
            className="rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-steel-light px-3 py-1.5 text-sm hover:bg-steel-border"
        >
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="invoice-table">
          <thead className="bg-steel-mid/60">
            <tr className="text-left">
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Invoice #
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Status</th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Type</th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Issued</th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Due</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted">
                Total
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted">
                Balance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {list.data.map((inv) => (
              <tr key={inv.id} className="hover:bg-steel-mid/30">
                <td className="px-4 py-2 font-mono text-sm">
                  <Link
                    href={`/billing/invoices/${inv.id}`}
                    className="text-orange-light hover:underline"
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
                <td className="px-4 py-2 text-text-secondary">{inv.invoiceType}</td>
                <td className="px-4 py-2 text-text-secondary">
                  {inv.issuedAt ? inv.issuedAt.slice(0, 10) : '—'}
                </td>
                <td className="px-4 py-2 text-text-secondary">
                  {inv.dueAt ? inv.dueAt.slice(0, 10) : '—'}
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
                <td className="px-4 py-12 text-center text-text-muted" colSpan={7}>
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
