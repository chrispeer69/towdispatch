import { fetchAccountingStatus, fetchSyncStatus } from '@/lib/api/accounting';
/**
 * /accounting/settings — Connect / disconnect QuickBooks Online + sync status.
 *
 * Server-renders the current connection state then hands off to a client
 * component for connect/disconnect/sync interactions.
 *
 * Both fetches are wrapped: the API legitimately answers 401/403 when no QBO
 * connection exists yet or the caller lacks finance scope, and the sidebar's
 * <Link> on every authenticated page prefetches this route — an uncaught throw
 * here would crash every page render in production.
 */
import { ApiError } from '@/lib/api/client';
import type { AccountingConnectStatusDto, SyncStatusResponse } from '@towdispatch/shared';
import type { JSX } from 'react';
import { AccountingSettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';

const NOT_CONNECTED_STATUS: AccountingConnectStatusDto = {
  configured: false,
  provider: 'quickbooks-online',
  sandbox: false,
  connection: null,
};

const EMPTY_SYNC: SyncStatusResponse = {
  totals: { pending: 0, processing: 0, failed: 0, deadLetter: 0, completed: 0 },
  recent: [],
};

function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export default async function AccountingSettingsPage(): Promise<JSX.Element> {
  let status: AccountingConnectStatusDto = NOT_CONNECTED_STATUS;
  let sync: SyncStatusResponse = EMPTY_SYNC;
  try {
    status = await fetchAccountingStatus();
  } catch (err) {
    if (!isAuthError(err)) throw err;
  }
  try {
    sync = await fetchSyncStatus();
  } catch (err) {
    if (!isAuthError(err)) throw err;
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">QuickBooks Online</h1>
        <p className="text-text-secondary-on-dark mt-1 max-w-prose">
          Connect a QuickBooks Online company so invoices, payments, and refunds flow into your
          books automatically. We never store your card data and your access token is encrypted at
          rest.
        </p>
      </header>
      <AccountingSettingsClient initialStatus={status} initialSync={sync} />
    </div>
  );
}
