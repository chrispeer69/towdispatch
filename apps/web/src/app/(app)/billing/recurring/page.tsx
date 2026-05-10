import { fetchRecurringSchedules, formatMoneyCents } from '@/lib/api/billing';

export const metadata = { title: 'Recurring billing — TowCommand' };

export default async function RecurringPage(): Promise<JSX.Element> {
  const schedules = await fetchRecurringSchedules();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Recurring billing
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Daily storage rates. Monthly invoices generated automatically on the 1st.
        </p>
      </header>
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Description
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Started
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted">
                Status
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted">
                Daily rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {schedules.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">{s.description}</td>
                <td className="px-4 py-2">{s.startedAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-text-secondary">
                  {s.endedAt ? `Ended ${s.endedAt.slice(0, 10)}` : 'Active'}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(s.dailyRateCents)}
                </td>
              </tr>
            ))}
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  No recurring schedules yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
