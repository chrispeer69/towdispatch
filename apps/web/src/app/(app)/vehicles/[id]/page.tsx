import { tryFetch } from '@/lib/api/client';
import { fetchVehicle } from '@/lib/api/resources';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VehicleForm } from '../vehicle-form';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Vehicle — US Tow Dispatch' };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VehicleDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  // /vehicles/new (and any other non-UUID slug) used to be reachable; the
  // route was deleted in Session 3.5. Catch the slug here and 404 cleanly so
  // we don't bubble the API's "validation_failed" up as a 500.
  if (!UUID_RX.test(id)) notFound();

  // tryFetch returns 4xx as data; treat any of them (400/401/403/404) the
  // same — the operator can't reach this record, so 404 the page.
  const result = await tryFetch(() => fetchVehicle(id));
  if (!result.data) notFound();
  const vehicle = result.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          <Link href="/customers" className="hover:text-text-primary-on-dark">
            ← Back
          </Link>
        </p>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          {vehicle.year ?? '—'} {vehicle.make ?? ''} {vehicle.model ?? ''}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          {vehicle.vin ? (
            <span className="font-mono">{vehicle.vin}</span>
          ) : (
            <span className="text-text-secondary-on-dark-on-dark/60">no VIN</span>
          )}
          {vehicle.plate ? (
            <>
              {' - '}
              <span className="font-mono">
                {vehicle.plate} / {vehicle.plateState ?? ''}
              </span>
            </>
          ) : null}
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Customers ({vehicle.customers.length})
        </h2>
        {vehicle.customers.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary-on-dark">No customers linked yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {vehicle.customers.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-[8px] border border-divider bg-bg-surface-elevated/30 px-3 py-2 text-sm"
              >
                <Link href={`/customers/${c.id}`} className="font-medium text-text-primary-on-dark">
                  {c.name}
                </Link>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
                  {c.relationship}
                  {c.isPrimary ? ' - primary' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VehicleForm mode="edit" initial={vehicle} />
    </div>
  );
}
