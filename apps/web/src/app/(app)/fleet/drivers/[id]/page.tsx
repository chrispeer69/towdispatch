import { tryFetch } from '@/lib/api/client';
import {
  fetchDocuments,
  fetchDriver,
  fetchDriverTrucks,
  fetchDvirs,
  fetchTrucks,
} from '@/lib/api/fleet';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DriverForm } from '../driver-form';
import { DriverAssignmentsSection } from './driver-assignments-section';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DriverDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const [driverRes, assignmentsRes, trucksRes, dvirsRes, docsRes] = await Promise.all([
    tryFetch(() => fetchDriver(id)),
    tryFetch(() => fetchDriverTrucks(id)),
    tryFetch(() => fetchTrucks({ perPage: '200' })),
    tryFetch(() => fetchDvirs({ driverId: id })),
    tryFetch(() => fetchDocuments({ ownerType: 'driver', ownerId: id })),
  ]);
  if (!driverRes.data) notFound();
  const driver = driverRes.data;
  const assignments = assignmentsRes.data ?? [];
  const trucks = trucksRes.data ?? { data: [], total: 0, page: 1, perPage: 200 };
  const dvirs = dvirsRes.data ?? [];
  const docs = docsRes.data ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
        <Link href="/fleet/drivers" className="hover:text-text-primary-on-dark">
          ← All drivers
        </Link>
      </p>
      <header className="space-y-1">
        <h2 className="font-condensed text-2xl font-extrabold uppercase tracking-tight">
          {driver.preferredName ?? driver.firstName} {driver.lastName}
        </h2>
        <p className="text-sm text-text-secondary-on-dark">
          {driver.cdlClass} · {driver.employmentStatus.replace('_', ' ')}
          {driver.email ? ` · ${driver.email}` : ''}
        </p>
      </header>

      <DriverAssignmentsSection driverId={driver.id} initial={assignments} trucks={trucks.data} />

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
          Documents
        </h3>
        {docs.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary-on-dark-on-dark/60">
            No documents on file.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {docs.map((d) => (
              <li key={d.id} className="flex justify-between">
                <span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
                    {d.docType}
                  </span>{' '}
                  {d.fileName}
                </span>
                <span className="font-mono text-xs text-text-secondary-on-dark-on-dark/60">
                  {d.expiresAt ? `exp ${d.expiresAt.slice(0, 10)}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
          Recent DVIRs
        </h3>
        {dvirs.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary-on-dark-on-dark/60">
            No DVIRs filed by this driver.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {dvirs.slice(0, 10).map((d) => (
              <li key={d.id} className="flex justify-between">
                <span>
                  {d.submittedAt.slice(0, 10)} · {d.type.replace('_', ' ')}
                </span>
                <span className="font-mono text-xs uppercase text-text-secondary-on-dark-on-dark/60">
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DriverForm mode="edit" initial={driver} />
    </div>
  );
}
