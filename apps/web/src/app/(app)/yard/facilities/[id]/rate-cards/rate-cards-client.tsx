'use client';
import { useUser } from '@/components/app-shell/session-provider';
import * as yard from '@/lib/api/yard-client';
import {
  type StorageRateCardDto,
  type StorageVehicleClass,
  type YardFacilityDto,
  storageVehicleClassValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const inputCls =
  'bg-bg-base border border-border-on-dark rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-orange';

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function RateCardsClient({
  facility,
  initial,
}: {
  facility: YardFacilityDto;
  initial: StorageRateCardDto[];
}): JSX.Element {
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [cards, setCards] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    vehicleClass: 'passenger' as StorageVehicleClass,
    dailyRate: '35.00',
    freeDays: '0',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const created = await yard.createRateCard(facility.id, {
        name: form.name.trim(),
        vehicleClass: form.vehicleClass,
        dailyRateCents: Math.round(Number(form.dailyRate) * 100),
        freeDays: Number(form.freeDays),
        effectiveFrom: form.effectiveFrom,
      });
      setCards((c) => [created, ...c]);
      setForm((f) => ({ ...f, name: '' }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      await yard.deleteRateCard(id);
      setCards((c) => c.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <Link href="/yard/facilities" className="text-xs text-accent-orange">
          ← Facilities
        </Link>
        <h1 className="text-2xl font-bold">{facility.name} — Rate Cards</h1>
      </header>

      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {canWrite && (
        <form
          onSubmit={create}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border-on-dark p-3"
        >
          <input
            className={inputCls}
            placeholder="Name"
            value={form.name}
            aria-label="Rate card name"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.vehicleClass}
            aria-label="Vehicle class"
            onChange={(e) =>
              setForm({ ...form, vehicleClass: e.target.value as StorageVehicleClass })
            }
          >
            {storageVehicleClassValues.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="text-xs text-text-secondary-on-dark">
            $/day
            <input
              className={`${inputCls} ml-1 w-20`}
              type="number"
              step="0.01"
              min="0"
              value={form.dailyRate}
              onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
            />
          </label>
          <label className="text-xs text-text-secondary-on-dark">
            Free days
            <input
              className={`${inputCls} ml-1 w-16`}
              type="number"
              min="0"
              value={form.freeDays}
              onChange={(e) => setForm({ ...form, freeDays: e.target.value })}
            />
          </label>
          <label className="text-xs text-text-secondary-on-dark">
            From
            <input
              className={`${inputCls} ml-1`}
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent-orange px-3 py-1 text-sm font-semibold text-black"
          >
            Add
          </button>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-text-secondary-on-dark">
          <tr>
            <th className="px-2 py-1">Class</th>
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">$/day</th>
            <th className="px-2 py-1">Free</th>
            <th className="px-2 py-1">Effective</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {cards.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-4 text-text-secondary-on-dark">
                No rate cards yet.
              </td>
            </tr>
          )}
          {cards.map((c) => (
            <tr key={c.id}>
              <td className="px-2 py-2 font-mono text-xs">{c.vehicleClass}</td>
              <td className="px-2 py-2">{c.name}</td>
              <td className="px-2 py-2">{money(c.dailyRateCents)}</td>
              <td className="px-2 py-2">{c.freeDays}d</td>
              <td className="px-2 py-2 text-xs">
                {c.effectiveFrom} → {c.effectiveTo ?? 'open'}
              </td>
              <td className="px-2 py-2 text-right">
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="text-text-secondary-on-dark hover:text-danger"
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
