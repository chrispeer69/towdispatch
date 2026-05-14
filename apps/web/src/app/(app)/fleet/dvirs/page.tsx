import { tryFetch } from '@/lib/api/client';
import { fetchDrivers, fetchDvirs, fetchTrucks } from '@/lib/api/fleet';
import type { PaginatedDrivers, PaginatedTrucks } from '@ustowdispatch/shared';
import { DvirSubmitClient } from './dvir-submit-client';

const EMPTY_TRUCKS: PaginatedTrucks = { data: [], total: 0, page: 1, perPage: 200 };
const EMPTY_DRIVERS: PaginatedDrivers = { data: [], total: 0, page: 1, perPage: 200 };

export default async function DvirsPage(): Promise<JSX.Element> {
  // tryFetch surfaces per-feature 401/403 as data (no redirect) and lets 5xx
  // hit the error boundary. Matches the pattern PR #6 standardized.
  const [dvirsRes, trucksRes, driversRes] = await Promise.all([
    tryFetch(() => fetchDvirs()),
    tryFetch(() => fetchTrucks({ perPage: '200' })),
    tryFetch(() => fetchDrivers({ perPage: '200' })),
  ]);
  const dvirs = dvirsRes.data ?? [];
  const trucks = trucksRes.data ?? EMPTY_TRUCKS;
  const drivers = driversRes.data ?? EMPTY_DRIVERS;
  return (
    <div className="space-y-6">
      <DvirSubmitClient trucks={trucks.data} drivers={drivers.data} />

      <section>
        <h2 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          Recent inspections
        </h2>
        {dvirs.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No DVIRs filed yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" data-testid="dvir-list">
            {dvirs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-[8px] border border-steel-border bg-steel-mid px-3 py-2"
              >
                <span>
                  {d.submittedAt.slice(0, 10)} · {d.type.replace('_', ' ')}
                </span>
                <span className="font-mono text-xs uppercase text-text-muted">{d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
