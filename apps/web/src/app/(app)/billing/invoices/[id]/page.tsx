import { fetchInvoice, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { invoiceStatusLabel, invoiceTypeLabel, paymentMethodLabel } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InvoiceActionsClient } from './invoice-actions-client';

export const metadata = { title: 'Invoice — US Tow Dispatch' };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const result = await tryFetch(() => fetchInvoice(id));
  // 401/403/404 are all "you can't see this invoice" from the operator's view.
  if (!result.data) notFound();
  const invoice = result.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            {invoiceTypeLabel[invoice.invoiceType]}
          </p>
          <h1
            className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight"
            data-testid="invoice-title"
          >
            {invoice.invoiceNumber}
          </h1>
          <p
            className="mt-1 text-sm text-text-secondary-on-dark"
            data-testid="invoice-status-label"
          >
            Status: <span className="font-medium">{invoiceStatusLabel[invoice.status]}</span>
          </p>
        </div>
        <InvoiceActionsClient invoice={invoice} />
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-divider p-4">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Bill to
          </h2>
          <div className="mt-2 text-sm">
            {invoice.billingAddress?.name ? (
              <p className="font-semibold">{invoice.billingAddress.name}</p>
            ) : null}
            {invoice.billingAddress?.street ? <p>{invoice.billingAddress.street}</p> : null}
            <p>
              {[
                invoice.billingAddress?.city,
                invoice.billingAddress?.state,
                invoice.billingAddress?.zip,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
            {invoice.billingAddress?.email ? (
              <p className="text-text-secondary-on-dark">{invoice.billingAddress.email}</p>
            ) : null}
            {invoice.billingAddress?.phone ? (
              <p className="text-text-secondary-on-dark">{invoice.billingAddress.phone}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-divider p-4">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Totals
          </h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-secondary-on-dark">Subtotal</dt>
              <dd className="font-mono">{formatMoneyCents(invoice.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary-on-dark">Tax</dt>
              <dd className="font-mono">{formatMoneyCents(invoice.taxCents)}</dd>
            </div>
            <div className="flex justify-between border-t border-divider pt-1">
              <dt className="font-semibold">Total</dt>
              <dd className="font-mono font-bold" data-testid="invoice-total">
                {formatMoneyCents(invoice.totalCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary-on-dark">Paid</dt>
              <dd className="font-mono">{formatMoneyCents(invoice.paidCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary-on-dark">Balance</dt>
              <dd className="font-mono" data-testid="invoice-balance">
                {formatMoneyCents(invoice.balanceCents)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-divider">
        <header className="border-b border-divider bg-bg-surface/60 px-4 py-2">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Line items
          </h2>
        </header>
        <table className="w-full divide-y divide-divider text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Description
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Qty
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Unit price
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {invoice.lineItems.map((li) => (
              <tr key={li.id}>
                <td className="px-4 py-2">{li.description}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {li.quantity} {li.unit}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(li.unitPriceCents)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(li.lineTotalCents)}
                </td>
              </tr>
            ))}
            {invoice.lineItems.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-text-secondary-on-dark-on-dark/60"
                >
                  No line items yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-divider">
        <header className="border-b border-divider bg-bg-surface/60 px-4 py-2">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Payments
          </h2>
        </header>
        {invoice.payments.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-secondary-on-dark-on-dark/60">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-divider">
            {invoice.payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-2 text-sm"
                data-testid={`payment-row-${p.id}`}
              >
                <div>
                  <p className="font-medium">{paymentMethodLabel[p.paymentMethod]}</p>
                  <p className="text-text-secondary-on-dark">
                    {p.receivedAt.slice(0, 10)}
                    {p.referenceNumber ? `  ·  ${p.referenceNumber}` : ''}
                  </p>
                </div>
                <span className="font-mono">{formatMoneyCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invoice.notes ? (
        <section className="rounded-lg border border-divider p-4 text-sm">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Notes
          </h2>
          <p className="mt-2">{invoice.notes}</p>
        </section>
      ) : null}

      <p className="text-center text-xs text-text-secondary-on-dark-on-dark/60">
        <Link href="/billing/invoices" className="hover:underline">
          ← Back to invoices
        </Link>
      </p>
    </div>
  );
}
