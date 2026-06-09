import { fetchCreditMemos, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';

export const metadata = { title: 'Credit memos — Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function CreditMemosPage(): Promise<JSX.Element> {
  // Session 9.8 token threading — see /billing/aging/page.tsx for why.
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchCreditMemos(token));
  const memos = result.data ?? [];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          Credit memos
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">{memos.length} total</p>
      </header>
      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Memo #
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Reason
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Applied to
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Issued
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {memos.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono">{m.memoNumber}</td>
                <td className="px-4 py-2">
                  <span className="font-medium">{m.reasonCode}</span>
                  <span className="block text-xs text-text-secondary-on-dark">{m.reason}</span>
                </td>
                <td className="px-4 py-2 text-text-secondary-on-dark">{m.appliedTo}</td>
                <td className="px-4 py-2">{m.issuedAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(m.amountCents)}
                </td>
              </tr>
            ))}
            {memos.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-text-secondary-on-dark-on-dark/60"
                >
                  No credit memos yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
