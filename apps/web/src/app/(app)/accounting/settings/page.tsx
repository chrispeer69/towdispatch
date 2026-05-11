/**
 * /accounting/settings — Connect / disconnect QuickBooks Online + sync status.
 *
 * Server-renders the current connection state then hands off to a client
 * component for connect/disconnect/sync interactions.
 */
import { fetchAccountingStatus, fetchSyncStatus } from '@/lib/api/accounting';
import type { JSX } from 'react';
import { AccountingSettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';

export default async function AccountingSettingsPage(): Promise<JSX.Element> {
  const [status, sync] = await Promise.all([fetchAccountingStatus(), fetchSyncStatus()]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">QuickBooks Online</h1>
        <p className="text-text-secondary mt-1 max-w-prose">
          Connect a QuickBooks Online company so invoices, payments, and refunds flow into your
          books automatically. We never store your card data and your access token is encrypted at
          rest.
        </p>
      </header>
      <AccountingSettingsClient initialStatus={status} initialSync={sync} />
    </div>
  );
}
