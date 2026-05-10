import { fetchPayments, formatMoneyCents } from '@/lib/api/billing';
import { paymentMethodLabel } from '@towcommand/shared';

export const metadata = { title: 'Payments — TowCommand' };

export default async function PaymentsPage(): Promise<JSX.Element> {
  const list = await fetchPayments({ limit: '100' });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Payments
        </h1>
        <p className="mt-1 text-sm text-text-secondary">{list.total} total</p>
      </header>
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="payment-table">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Date</th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Method</th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Reference
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">Status</th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {list.data.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.receivedAt.slice(0, 10)}</td>
                <td className="px-4 py-2">{paymentMethodLabel[p.paymentMethod]}</td>
                <td className="px-4 py-2 font-mono text-text-secondary">
                  {p.referenceNumber ?? '—'}
                </td>
                <td className="px-4 py-2 text-text-secondary">{p.status}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(p.amountCents)}
                </td>
              </tr>
            ))}
            {list.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                  No payments yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
