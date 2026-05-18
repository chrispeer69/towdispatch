'use client';

/**
 * /driver/offline — surface the localStorage queue of pending mutations.
 * Each entry shows action kind, age, attempt count, last error, and a
 * "Retry now" button that runs replayQueue() against the API.
 */
import { DriverShell } from '@/components/driver/driver-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  type QueuedAction,
  type ReplayResult,
  clearQueue,
  maybeReplay,
  readQueue,
} from '@/lib/driver/offline-queue';
import { Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export default function DriverOfflinePage(): JSX.Element {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ReplayResult | null>(null);

  const refresh = useCallback((): void => {
    setItems(readQueue());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function retry(): Promise<void> {
    setBusy(true);
    try {
      const result = await maybeReplay();
      setLast(result);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function purge(): void {
    if (!window.confirm('Discard every pending action? They will not be sent to dispatch.')) return;
    clearQueue();
    refresh();
  }

  return (
    <DriverShell title="Offline queue" backHref="/driver/workspace">
      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          <p className="text-sm">
            Actions you took while offline are stored here until they can be replayed to the
            dispatch server.
          </p>
          <div className="flex gap-2">
            <Button size="touch" className="flex-1" onClick={() => void retry()} disabled={busy}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Retry all (${items.length})`}
            </Button>
            {items.length > 0 ? (
              <Button size="touch" variant="ghost" onClick={purge}>
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          {last ? (
            <p className="text-xs text-text-secondary-on-dark">
              Last replay: {last.applied} applied, {last.skipped} skipped, {last.failed} failed.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">
          Queue is empty. Everything you do online posts immediately.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.clientEventUuid}>
              <Card>
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-xs">{a.actionKind}</p>
                    <p className="text-xs text-text-secondary-on-dark">
                      {formatRelative(a.clientTimestamp)}
                    </p>
                  </div>
                  {a.jobId ? (
                    <p className="text-xs text-text-secondary-on-dark">
                      Job <span className="font-mono">{a.jobId.slice(0, 8)}…</span>
                    </p>
                  ) : null}
                  <p className="text-xs">
                    Attempts: <span className="font-mono">{a.attemptCount}</span>
                  </p>
                  {a.lastError ? (
                    <p className="text-xs text-danger">Last error: {a.lastError}</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </DriverShell>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
