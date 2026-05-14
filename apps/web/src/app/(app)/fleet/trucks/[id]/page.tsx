import { tryFetch } from '@/lib/api/client';
import {
  fetchDocuments,
  fetchDvirs,
  fetchTruck,
  fetchTruckDrivers,
  fetchTruckRecords,
  fetchTruckSchedules,
} from '@/lib/api/fleet';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TruckForm } from '../truck-form';
import { TruckDocumentsSection } from './truck-documents-section';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TruckDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const [truckRes, schedulesRes, recordsRes, dvirsRes, driversRes, docsRes] = await Promise.all([
    tryFetch(() => fetchTruck(id)),
    tryFetch(() => fetchTruckSchedules(id)),
    tryFetch(() => fetchTruckRecords(id)),
    tryFetch(() => fetchDvirs({ truckId: id })),
    tryFetch(() => fetchTruckDrivers(id)),
    tryFetch(() => fetchDocuments({ ownerType: 'truck', ownerId: id })),
  ]);
  if (!truckRes.data) notFound();
  const truck = truckRes.data;
  const schedules = schedulesRes.data ?? [];
  const records = recordsRes.data ?? [];
  const dvirs = dvirsRes.data ?? [];
  const drivers = driversRes.data ?? [];
  const docs = docsRes.data ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        <Link href="/fleet/trucks" className="hover:text-text-primary">
          ← All trucks
        </Link>
      </p>
      <header className="space-y-1">
        <h2 className="font-condensed text-2xl font-extrabold uppercase tracking-tight">
          {truck.unitNumber}
        </h2>
        <p className="text-sm text-text-secondary">
          {truck.year ?? ''} {truck.make ?? ''} {truck.model ?? ''} ·{' '}
          {truck.truckType.replace('_', ' ')}
          {truck.capacityClass ? ` · ${truck.capacityClass}` : ''}
        </p>
      </header>

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          Assigned drivers
        </h3>
        {drivers.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No drivers assigned.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {drivers.map((a) => (
              <li key={a.id} className="text-sm">
                <Link href={`/fleet/drivers/${a.driverId}`} className="hover:text-orange-light">
                  {a.driverId.slice(0, 8)}…
                </Link>
                {a.isPrimary ? (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-orange-light">
                    primary
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <TruckDocumentsSection truckId={truck.id} initialDocs={docs} />

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          Maintenance schedules
        </h3>
        {schedules.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No schedules configured.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {schedules.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span>
                  {s.serviceType}
                  {s.customLabel ? ` (${s.customLabel})` : ''}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  next due: {s.nextDueAt ?? '—'}
                  {s.nextDueMiles !== null ? ` / ${s.nextDueMiles.toLocaleString()} mi` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          Maintenance history
        </h3>
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No service records yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {records.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>
                  {r.performedAt} · {r.serviceType}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  ${(r.costCents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          Recent DVIRs
        </h3>
        {dvirs.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No DVIRs filed for this truck.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {dvirs.slice(0, 10).map((d) => (
              <li key={d.id} className="flex justify-between">
                <span>
                  {d.submittedAt.slice(0, 10)} · {d.type.replace('_', ' ')}
                </span>
                <span className="font-mono text-xs uppercase text-text-muted">{d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TruckForm mode="edit" initial={truck} />
    </div>
  );
}
