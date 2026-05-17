/**
 * /settings/invoice-defaults — Build 5 Part 4 tenant-wide invoice
 * defaults. Replaces the prior "Coming soon" placeholder. Owners and
 * admins can change these values; everyone else sees the form
 * disabled but still readable.
 */
import { fetchTenantInvoiceDefaults } from '@/lib/api/ar';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import { DEFAULT_TENANT_INVOICE_DEFAULTS } from '@ustowdispatch/shared';
import { findSettingsTab } from '../tabs';
import { InvoiceDefaultsForm } from './invoice-defaults-form';

const TAB = findSettingsTab('invoice-defaults');

export const dynamic = 'force-dynamic';

export default async function InvoiceDefaultsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() => fetchTenantInvoiceDefaults(token));
  const initial = result.data ?? DEFAULT_TENANT_INVOICE_DEFAULTS;
  const errorMsg = result.error?.message ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>
      <InvoiceDefaultsForm initial={initial} errorMessage={errorMsg} />
    </div>
  );
}
