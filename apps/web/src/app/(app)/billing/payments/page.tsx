import { type PaymentListResponse, fetchPayments, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import { paymentMethodLabel } from '@towdispatch/shared';

export const metadata = { title: 'Payments — Tow Dispatch' };
export const dynamic = 'force-dynamic';

const EMPTY_PAYMENTS: PaymentListResponse = { data: [], total: 0 };

export default async function PaymentsPage(): Promise<JSX.Element> {
  // Session 9.8 token threading — see /billing/aging/page.tsx for why.
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchPayments({ limit: '100' }, token));
  const list = result.data ?? EMPTY_PAYMENTS;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">{list.total} total</p>
      </header>
      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm" data-testid="payment-table">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Date
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Method
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Reference
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Status
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {list.data.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.receivedAt.slice(0, 10)}</td>
                <td className="px-4 py-2">{paymentMethodLabel[p.paymentMethod]}</td>
                <td className="px-4 py-2 font-mono text-text-secondary-on-dark">
                  {p.referenceNumber ?? 'â€”'}
                </td>
                <td className="px-4 py-2 text-text-secondary-on-dark">{p.status}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(p.amountCents)}
                </td>
              </tr>
            ))}
            {list.data.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-text-secondary-on-dark-on-dark/60"
                >
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
