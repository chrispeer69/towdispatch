'use client';

import type { AccountingConnectStatusDto, SyncStatusResponse } from '@towcommand/shared';
import { type JSX, useState, useTransition } from 'react';

interface Props {
  initialStatus: AccountingConnectStatusDto;
  initialSync: SyncStatusResponse;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Onboarding in progress',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error — reconnect required',
};

export function AccountingSettingsClient({ initialStatus, initialSync }: Props): JSX.Element {
  const [status, setStatus] = useState(initialStatus);
  const [sync, setSync] = useState(initialSync);
  const [pending, start] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const [s, q] = await Promise.all([
      fetch('/api/accounting/connect/status', { cache: 'no-store' }).then(
        (r) => r.json() as Promise<AccountingConnectStatusDto>,
      ),
      fetch('/api/accounting/sync-status', { cache: 'no-store' }).then(
        (r) => r.json() as Promise<SyncStatusResponse>,
      ),
    ]);
    setStatus(s);
    setSync(q);
  };

  const onConnect = (): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        const res = await fetch('/api/accounting/connect/start', { method: 'POST' });
        if (!res.ok) throw new Error('connect/start failed');
        const body = (await res.json()) as { authorizationUrl: string };
        window.location.href = body.authorizationUrl;
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onDisconnect = (): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        await fetch('/api/accounting/connect/disconnect', { method: 'POST' });
        await refresh();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onRetry = (entityType: string, entityId: string): void => {
    start(async () => {
      try {
        setErrorMessage(null);
        await fetch(`/api/accounting/sync/retry/${entityType}/${entityId}`, { method: 'POST' });
        await refresh();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const connectionLabel = status.connection
    ? (STATUS_LABELS[status.connection.status] ?? status.connection.status)
    : 'Not connected';

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-steel-light p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Connection</h2>
            <p className="text-sm text-text-secondary mt-1">
              Status: <span className="font-mono">{connectionLabel}</span>
            </p>
            {status.connection?.realmId ? (
              <p className="text-xs text-text-secondary mt-1 font-mono">
                realmId: {status.connection.realmId}
              </p>
            ) : null}
            <p className="text-xs text-text-secondary mt-1">
              Environment:{' '}
              <span className="font-mono">{status.sandbox ? 'sandbox' : 'production'}</span>
            </p>
            {!status.configured ? (
              <p className="text-xs text-yellow-300 mt-2">
                QBO_CLIENT_ID is not configured — using the stub provider so dev can exercise the
                full flow without real Intuit credentials.
              </p>
            ) : null}
          </div>
          <div className="space-x-2">
            {status.connection?.status === 'connected' ? (
              <button
                type="button"
                onClick={onDisconnect}
                disabled={pending}
                className="rounded bg-steel px-3 py-2 text-sm border border-border hover:border-red-500"
              >
                Disconnect
              </button>
            ) : null}
            <button
              type="button"
              onClick={onConnect}
              disabled={pending}
              className="rounded bg-action px-3 py-2 text-sm font-semibold text-white"
            >
              {status.connection?.status === 'connected' ? 'Reconnect' : 'Connect QuickBooks'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-steel-light p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sync status</h2>
          <button
            type="button"
            onClick={() => start(refresh)}
            disabled={pending}
            className="rounded bg-steel px-3 py-2 text-sm border border-border hover:border-action"
          >
            Refresh
          </button>
        </div>
        <dl className="grid grid-cols-5 gap-4 text-sm">
          <div>
            <dt className="text-text-secondary">Pending</dt>
            <dd className="font-mono">{sync.totals.pending}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Processing</dt>
            <dd className="font-mono">{sync.totals.processing}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Completed</dt>
            <dd className="font-mono">{sync.totals.completed}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Failed</dt>
            <dd className="font-mono">{sync.totals.failed}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Dead-letter</dt>
            <dd className="font-mono">{sync.totals.deadLetter}</dd>
          </div>
        </dl>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-secondary">
              <th className="py-1">Entity</th>
              <th className="py-1">Status</th>
              <th className="py-1">Retries</th>
              <th className="py-1">Last error</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {sync.recent.slice(0, 25).map((j) => (
              <tr key={j.id} className="border-t border-border">
                <td className="py-1 font-mono">
                  {j.entityType}/{j.entityId.slice(0, 8)}
                </td>
                <td className="py-1">{j.status}</td>
                <td className="py-1">{j.retryCount}</td>
                <td className="py-1 truncate max-w-[20rem]">{j.lastError ?? ''}</td>
                <td className="py-1">
                  {j.status === 'failed' || j.status === 'dead_letter' ? (
                    <button
                      type="button"
                      onClick={() => onRetry(j.entityType, j.entityId)}
                      className="text-action hover:underline"
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {errorMessage ? (
        <p role="alert" className="text-red-400 text-sm">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
