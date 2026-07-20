import { fetchInvoiceReview } from '@/lib/api/billing';
import { tryFetch } from '@/lib/api/client';
import { fetchDrivers } from '@/lib/api/fleet';
import { getSessionToken } from '@/lib/auth/session';
import { invoiceStatusLabel } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { InvoiceReviewClient } from './invoice-review-client';

export const metadata = { title: 'Invoice review — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function InvoiceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchInvoiceReview(id, token));
  // If the review endpoint refuses (invoice already posted), fall back to
  // the regular detail page so the dispatcher isn't stuck on a 4xx.
  if (!result.data) {
    if (result.error?.status === 400) {
      redirect(`/billing/invoices/${id}`);
    }
    notFound();
  }
  const review = result.data;

  // Roster used by the "+ Add driver" picker. Includes the currently
  // assigned crew; the client filters that set out client-side. Pull a
  // generous page so the chip search is usable without pagination.
  const driversResult = await tryFetch(() =>
    fetchDrivers({ perPage: '200', active: 'true' }, token),
  );
  const allDrivers =
    driversResult.data?.data.map((d) => ({
      id: d.id,
      name: [d.preferredName ?? d.firstName, d.lastName].filter(Boolean).join(' '),
      defaultCommissionPct:
        d.defaultCommissionPct !== null && d.defaultCommissionPct !== undefined
          ? Number(d.defaultCommissionPct)
          : null,
    })) ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Review draft invoice
          </p>
          <h1
            className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight"
            data-testid="invoice-review-title"
          >
            {review.invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Status:{' '}
            <span className="font-medium" data-testid="invoice-review-status">
              {invoiceStatusLabel[review.invoice.status]}
            </span>
            {review.job ? (
              <>
                {' - Job '}
                <Link
                  href={`/jobs/${review.job.id}`}
                  className="font-mono text-brand-primary hover:underline"
                >
                  {review.job.jobNumber}
                </Link>
                {review.job.completedAt
                  ? ` - Completed ${review.job.completedAt.slice(11, 16)}`
                  : ''}
              </>
            ) : null}
          </p>
          <p className="text-xs text-text-secondary-on-dark-on-dark/60">
            Customer: {review.customer?.name ?? '—'} - Account: {review.account?.name ?? 'Cash'}
          </p>
        </div>
        <Link
          href="/billing/invoices"
          className="rounded-md bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
        >
          ← Invoices
        </Link>
      </header>

      <InvoiceReviewClient review={review} allDrivers={allDrivers} />
    </div>
  );
}
