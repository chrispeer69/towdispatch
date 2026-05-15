import { tryFetch } from '@/lib/api/client';
import { fetchDueMaintenance } from '@/lib/api/fleet';

export default async function MaintenancePage(): Promise<JSX.Element> {
  const result = await tryFetch(() => fetchDueMaintenance());
  const due = result.data ?? [];
  return (
    <div className="space-y-4">
      <h2 className="font-condensed text-xl font-extrabold uppercase tracking-tight">Due now</h2>
      {due.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark-on-dark/60">
          No maintenance currently due.
        </p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="maintenance-due-list">
          {due.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-[8px] border border-divider bg-bg-surface px-3 py-2"
            >
              <span>
                {s.serviceType}
                {s.customLabel ? ` (${s.customLabel})` : ''}
              </span>
              <span className="font-mono text-xs text-text-secondary-on-dark-on-dark/60">
                {s.nextDueAt ?? '—'}
                {s.nextDueMiles !== null ? ` / ${s.nextDueMiles.toLocaleString()} mi` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
