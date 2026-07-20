'use client';
import { useUser } from '@/components/app-shell/session-provider';
import * as yard from '@/lib/api/yard-client';
import type { YardFacilityDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';

export function FacilitiesClient({ initial }: { initial: YardFacilityDto[] }): JSX.Element {
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [facilities, setFacilities] = useState(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await yard.createFacility({ name: name.trim(), isActive: true });
      setFacilities((f) => [...f, created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      await yard.deleteFacility(id);
      setFacilities((f) => f.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Yard Facilities</h1>
        <Link href="/yard/gate-search" className="text-sm text-accent-orange">
          Gate search →
        </Link>
      </header>

      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {canWrite && (
        <form onSubmit={create} className="flex gap-2">
          <input
            className={inputCls}
            placeholder="New facility name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New facility name"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      <ul className="divide-y divide-divider rounded-md border border-border-on-dark">
        {facilities.length === 0 && (
          <li className="px-4 py-6 text-sm text-text-secondary-on-dark">No facilities yet.</li>
        )}
        {facilities.map((f) => (
          <li key={f.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-semibold">{f.name}</p>
              <p className="text-xs text-text-secondary-on-dark">
                {f.isActive ? 'Active' : 'Inactive'}
                {f.address?.city ? ` - ${f.address.city}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link href={`/yard/facilities/${f.id}/map`} className="text-accent-orange">
                Stall map
              </Link>
              <Link href={`/yard/facilities/${f.id}/rate-cards`} className="text-accent-orange">
                Rate cards
              </Link>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="text-text-secondary-on-dark hover:text-danger"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
