import { tryFetch } from '@/lib/api/client';
import { fetchCustomer } from '@/lib/api/resources';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerForm } from '../customer-form';
import { CustomerVehiclesSection } from './customer-vehicles-section';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Customer — US Tow DISPATCH' };

export default async function CustomerDetailPage({ params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  const result = await tryFetch(() => fetchCustomer(id));
  // 401/403/404 — unreachable resource, 404 the operator out.
  if (!result.data) notFound();
  const customer = result.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          <Link href="/customers" className="hover:text-text-primary">
            ← All customers
          </Link>
        </p>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          {customer.name}
        </h1>
        <p className="text-sm text-text-secondary">
          {customer.type.replace('_', ' ')} ·{' '}
          {customer.phone ?? <span className="text-text-muted">no phone</span>}
        </p>
      </header>

      {/*
        Session 4 (Call Intake) is the primary entry point for adding vehicles
        to the system. This inline UI is for cases where an operator is
        updating a customer record outside of a tow job.
      */}
      <CustomerVehiclesSection customerId={customer.id} vehicles={customer.vehicles} />

      <CustomerForm mode="edit" initial={customer} />
    </div>
  );
}
