/**
 * /accounting/mapping — Map US Tow Dispatch's internal billing categories onto the
 * tenant's QuickBooks chart of accounts. Server-renders the current chart and
 * existing mappings, then the client component handles save.
 */
import { fetchAccountMappings, fetchChartOfAccounts } from '@/lib/api/accounting';
import type { JSX } from 'react';
import { MappingClient } from './mapping-client';

export const dynamic = 'force-dynamic';

export default async function AccountingMappingPage(): Promise<JSX.Element> {
  // Either fetch can fail when no connection has been established — render an
  // empty UI rather than a crash, so the page still loads on a fresh tenant.
  let chart: Awaited<ReturnType<typeof fetchChartOfAccounts>> | null = null;
  let mappings: Awaited<ReturnType<typeof fetchAccountMappings>> | null = null;
  try {
    chart = await fetchChartOfAccounts();
  } catch {
    /* keep null — UI shows "connect first" hint */
  }
  try {
    mappings = await fetchAccountMappings();
  } catch {
    /* keep null */
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Account mapping</h1>
        <p className="text-text-secondary-on-dark mt-1 max-w-prose">
          Choose which account in your QuickBooks chart receives each internal billing category. New
          invoices and payments will post to the mapped accounts; remove a mapping to fall back to
          QuickBooks defaults.
        </p>
      </header>
      <MappingClient chart={chart} mappings={mappings} />
    </div>
  );
}
