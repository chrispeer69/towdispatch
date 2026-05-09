import { ApiError } from '@/lib/api/client';
import { fetchVehicle } from '@/lib/api/resources';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VehicleForm } from '../vehicle-form';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Vehicle — TowCommand' };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VehicleDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  // /vehicles/new (and any other non-UUID slug) used to be reachable; the
  // route was deleted in Session 3.5. Catch the slug here and 404 cleanly so
  // we don't bubble the API's "validation_failed" up as a 500.
  if (!UUID_RX.test(id)) notFound();

  let vehicle: Awaited<ReturnType<typeof fetchVehicle>>;
  try {
    vehicle = await fetchVehicle(id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          <Link href="/customers" className="hover:text-text-primary">
            ← Back
          </Link>
        </p>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          {vehicle.year ?? '—'} {vehicle.make ?? ''} {vehicle.model ?? ''}
        </h1>
        <p className="text-sm text-text-secondary">
          {vehicle.vin ? (
            <span className="font-mono">{vehicle.vin}</span>
          ) : (
            <span className="text-text-muted">no VIN</span>
          )}
          {vehicle.plate ? (
            <>
              {' · '}
              <span className="font-mono">
                {vehicle.plate} / {vehicle.plateState ?? ''}
              </span>
            </>
          ) : null}
        </p>
      </header>

      <section className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Customers ({vehicle.customers.length})
        </h2>
        {vehicle.customers.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">No customers linked yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {vehicle.customers.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-[8px] border border-steel-border bg-steel-light/30 px-3 py-2 text-sm"
              >
                <Link href={`/customers/${c.id}`} className="font-medium text-text-primary">
                  {c.name}
                </Link>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {c.relationship}
                  {c.isPrimary ? ' · primary' : ''}
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
