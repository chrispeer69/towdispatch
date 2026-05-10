import { fetchDrivers, fetchDvirs, fetchTrucks } from '@/lib/api/fleet';
import { DvirSubmitClient } from './dvir-submit-client';

export default async function DvirsPage(): Promise<JSX.Element> {
  const [dvirs, trucks, drivers] = await Promise.all([
    fetchDvirs().catch(() => []),
    fetchTrucks({ perPage: '200' }).catch(() => ({ data: [], total: 0, page: 1, perPage: 200 })),
    fetchDrivers({ perPage: '200' }).catch(() => ({ data: [], total: 0, page: 1, perPage: 200 })),
  ]);
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
