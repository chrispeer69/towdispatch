'use client';
import * as yard from '@/lib/api/yard-client';
import type { GateSearchMatch } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function GateSearchClient(): JSX.Element {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<GateSearchMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await yard.gateSearch(q.trim());
      setMatches(res.matches);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold">Gate Search</h1>
      <form onSubmit={search} className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-on-dark bg-bg-base px-3 py-2 text-sm focus:border-accent-orange focus:outline-none"
          placeholder="Plate, VIN, or payer name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Gate search query"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent-orange px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {matches !== null && (
        <div className="space-y-2">
          {matches.length === 0 && (
            <p className="text-sm text-text-secondary-on-dark">No matches.</p>
          )}
          {matches.map((m) => (
            <div
              key={m.impoundId}
              className="flex items-center justify-between rounded-md border border-border-on-dark p-3"
            >
              <div className="text-sm">
                <p className="font-semibold">{m.vehicleDescription}</p>
                <p className="text-text-secondary-on-dark">
                  {m.licensePlate ?? 'no plate'}
                  {m.licenseState ? ` (${m.licenseState})` : ''} - {m.vehicleVin ?? 'no VIN'} -{' '}
                  {m.status}
                </p>
                <p className="text-text-secondary-on-dark">
                  {m.facilityName
                    ? `${m.facilityName} / ${m.stallLabel ?? '—'}`
                    : 'Not parked in a stall'}
                  {m.releaseStatus ? ` - release: ${m.releaseStatus}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm">{money(m.balanceOwedCents)}</p>
                <Link href={`/yard/release/${m.impoundId}`} className="text-sm text-accent-orange">
                  Release →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
