/**
 * Portal dashboard (Session 32): the signed-in customer's jobs + invoices.
 * Server component — fetches with the portal token; the API scopes both lists
 * to the caller's customer.
 */
import { portalApiSafe } from '@/lib/portal/client';
import { readPortalToken } from '@/lib/portal/cookies';
import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import { requirePortalUser } from '@/lib/portal/session';
import type { PortalInvoiceListResponse, PortalJobListResponse } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { formatDate, formatMoney, statusLabel, titleCase } from '../format';
import { PortalLogoutButton, PortalPayButton } from '../portal-actions';

export const dynamic = 'force-dynamic';

export default async function PortalDashboardPage(): Promise<JSX.Element> {
  const user = await requirePortalUser();
  const token = await readPortalToken();
  const t = portalMessages(await getPortalLocale());

  const [jobsRes, invoicesRes] = await Promise.all([
    portalApiSafe<PortalJobListResponse>('/portal/jobs', { token }),
    portalApiSafe<PortalInvoiceListResponse>('/portal/invoices', { token }),
  ]);
  const jobs = jobsRes.data?.jobs ?? [];
  const invoices = invoicesRes.data?.invoices ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{user.customerName}</p>
        <PortalLogoutButton label={t.logOut} />
      </div>

      <section>
        <h2 className="mb-3 text-base font-bold text-neutral-900">{t.dashboardTitle}</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">{t.noJobs}</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/portal/jobs/${job.id}`}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300"
                >
                  <span>
                    <span className="block text-sm font-semibold text-neutral-900">
                      {titleCase(job.serviceType)} · {job.jobNumber}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {job.pickupAddress} · {formatDate(job.createdAt)}
                    </span>
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                    {statusLabel(job.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-bold text-neutral-900">{t.invoicesTitle}</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-neutral-500">{t.noInvoices}</p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3"
              >
                <span>
                  <span className="block text-sm font-semibold text-neutral-900">
                    {inv.invoiceNumber}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {t.balanceDue}: {formatMoney(inv.balanceCents, inv.currency)} ·{' '}
                    {titleCase(inv.status)}
                  </span>
                </span>
                {inv.payable ? (
                  <PortalPayButton invoiceId={inv.id} label={t.payInvoice} />
                ) : (
                  <span className="text-xs text-neutral-400">{t.paid}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
