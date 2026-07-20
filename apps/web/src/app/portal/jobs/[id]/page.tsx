/**
 * Portal job detail (Session 32): status, route, assigned driver, and the
 * job's invoice with a pay button. Evidence photos are deferred (field present
 * but empty) — see SESSION_32_DECISIONS.md. Server component scoped to the
 * caller's customer by the API.
 */
import { portalApiSafe } from '@/lib/portal/client';
import { readPortalToken } from '@/lib/portal/cookies';
import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import { requirePortalUser } from '@/lib/portal/session';
import type { PortalJobDetailDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { formatDate, formatMoney, statusLabel, titleCase } from '../../format';
import { PortalPayButton } from '../../portal-actions';

export const dynamic = 'force-dynamic';

export default async function PortalJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  await requirePortalUser();
  const token = await readPortalToken();
  const t = portalMessages(await getPortalLocale());
  const { id } = await params;

  const result = await portalApiSafe<PortalJobDetailDto>(`/portal/jobs/${id}`, { token });
  if (result.error) notFound();
  const job = result.data;

  return (
    <div className="space-y-6">
      <Link href="/portal/dashboard" className="text-sm text-neutral-500 underline">
        ← {t.backToJobs}
      </Link>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-neutral-900">
            {titleCase(job.serviceType)} - {job.jobNumber}
          </h1>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
            {statusLabel(job.status)}
          </span>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label={t.pickup} value={job.pickupAddress} />
          {job.dropoffAddress ? <Row label={t.dropoff} value={job.dropoffAddress} /> : null}
          {job.driver ? <Row label={t.driver} value={job.driver.name} /> : null}
          <Row label={t.jobStatus} value={statusLabel(job.status)} />
          <Row label="Created" value={formatDate(job.createdAt)} />
        </dl>
      </div>

      {job.invoice ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-900">{job.invoice.invoiceNumber}</p>
              <p className="text-xs text-neutral-500">
                {t.balanceDue}: {formatMoney(job.invoice.balanceCents, job.invoice.currency)} -{' '}
                {titleCase(job.invoice.status)}
              </p>
            </div>
            {job.invoice.payable ? (
              <PortalPayButton invoiceId={job.invoice.id} label={t.payInvoice} />
            ) : (
              <span className="text-xs text-neutral-400">{t.paid}</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}
