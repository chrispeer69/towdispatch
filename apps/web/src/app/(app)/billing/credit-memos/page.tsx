import { fetchCreditMemos, formatMoneyCents } from '@/lib/api/billing';

export const metadata = { title: 'Credit memos — TowCommand' };

export default async function CreditMemosPage(): Promise<JSX.Element> {
  const memos = await fetchCreditMemos();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Credit memos
        </h1>
        <p className="mt-1 text-sm text-text-secondary">{memos.length} total</p>
      </header>
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Memo #
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Reason
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Applied to
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Issued
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {memos.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono">{m.memoNumber}</td>
                <td className="px-4 py-2">
                  <span className="font-medium">{m.reasonCode}</span>
                  <span className="block text-xs text-text-secondary">{m.reason}</span>
                </td>
                <td className="px-4 py-2 text-text-secondary">{m.appliedTo}</td>
                <td className="px-4 py-2">{m.issuedAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(m.amountCents)}
                </td>
              </tr>
            ))}
            {memos.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
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
