'use client';
import { useUser } from '@/components/app-shell/session-provider';
import * as yard from '@/lib/api/yard-client';
import type { StorageBillingRunDto } from '@ustowdispatch/shared';
import { type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function BillingRunsClient({ initial }: { initial: StorageBillingRunDto[] }): JSX.Element {
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [runs, setRuns] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function runNow(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await yard.runBillingNow();
      setNote(
        `Run complete: ${r.vehiclesCharged} vehicle(s) charged ${money(r.totalChargedCents)} (${r.chargesWritten} new charge rows).`,
      );
      setRuns(await yard.listBillingRuns());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Storage Billing Runs</h1>
        {canWrite && (
          <button
            type="button"
            onClick={runNow}
            disabled={busy}
            className="rounded-md bg-accent-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Running…' : 'Run now'}
          </button>
        )}
      </header>

      {note && <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{note}</p>}
      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-text-secondary-on-dark">
          <tr>
            <th className="px-2 py-1">Ran</th>
            <th className="px-2 py-1">Period</th>
            <th className="px-2 py-1">Vehicles</th>
            <th className="px-2 py-1">Total</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {runs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-4 text-text-secondary-on-dark">
                No runs yet.
              </td>
            </tr>
          )}
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="px-2 py-2 text-xs">{new Date(r.ranAt).toLocaleString()}</td>
              <td className="px-2 py-2 text-xs">
                {r.periodStart === r.periodEnd ? r.periodStart : `${r.periodStart}→${r.periodEnd}`}
              </td>
              <td className="px-2 py-2">{r.vehiclesCharged}</td>
              <td className="px-2 py-2">{money(r.totalChargedCents)}</td>
              <td className="px-2 py-2">
                <span
                  className={
                    r.status === 'completed'
                      ? 'text-success'
                      : r.status === 'failed'
                        ? 'text-danger'
                        : 'text-text-secondary-on-dark'
                  }
                >
                  {r.status}
                </span>
                {r.errorText ? (
                  <span className="ml-2 text-xs text-danger">{r.errorText}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
