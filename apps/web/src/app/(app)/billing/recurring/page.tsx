import { fetchRecurringSchedules, formatMoneyCents } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';

export const metadata = { title: 'Recurring billing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function RecurringPage(): Promise<JSX.Element> {
  // Session 9.8 token threading — see /billing/aging/page.tsx for why.
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchRecurringSchedules(token));
  const schedules = result.data ?? [];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          Recurring billing
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Daily storage rates. Monthly invoices generated automatically on the 1st.
        </p>
      </header>
      <div className="overflow-hidden rounded-lg border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Description
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Started
              </th>
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Status
              </th>
              <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Daily rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {schedules.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">{s.description}</td>
                <td className="px-4 py-2">{s.startedAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-text-secondary-on-dark">
                  {s.endedAt ? `Ended ${s.endedAt.slice(0, 10)}` : 'Active'}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatMoneyCents(s.dailyRateCents)}
                </td>
              </tr>
            ))}
            {schedules.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-text-secondary-on-dark-on-dark/60"
                >
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
