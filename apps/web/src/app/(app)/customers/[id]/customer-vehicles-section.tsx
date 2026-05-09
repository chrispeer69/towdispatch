'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
/**
 * Inline vehicles editor for a customer detail page. Lets the operator add
 * a new vehicle for the customer (creates the vehicle + the link in two
 * sequential calls), and remove an existing link.
 *
 * Session 4 (Call Intake) is the primary path for capturing vehicle data
 * during a real tow job. This UI is for cases where an operator is updating
 * a customer record OUTSIDE of a tow job — e.g. correcting a typo, adding a
 * spouse's car, deleting a sold vehicle.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface CustomerVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  plateState: string | null;
  relationship: string;
  isPrimary: boolean;
}

interface Props {
  customerId: string;
  vehicles: CustomerVehicle[];
}

export function CustomerVehiclesSection({ customerId, vehicles }: Props): JSX.Element {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    year: '',
    make: '',
    model: '',
    plate: '',
    plateState: '',
    vin: '',
    specialInstructions: '',
  });

  async function handleAdd(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        vehicleClass: 'unknown',
        drivetrain: 'unknown',
      };
      if (form.year) payload.year = Number(form.year);
      if (form.make) payload.make = form.make;
      if (form.model) payload.model = form.model;
      if (form.plate) payload.plate = form.plate;
      if (form.plateState) payload.plateState = form.plateState.toUpperCase();
      if (form.vin) payload.vin = form.vin.toUpperCase();
      if (form.specialInstructions) payload.specialInstructions = form.specialInstructions;

      const createRes = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) {
        const j = (await createRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Failed to create vehicle (${createRes.status})`);
      }
      const created = (await createRes.json()) as { id: string };

      const linkRes = await fetch(`/api/customers/${customerId}/vehicles/${created.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationship: 'owner', isPrimary: vehicles.length === 0 }),
      });
      if (!linkRes.ok) {
        const j = (await linkRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Failed to link vehicle (${linkRes.status})`);
      }

      setForm({
        year: '',
        make: '',
        model: '',
        plate: '',
        plateState: '',
        vin: '',
        specialInstructions: '',
      });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(vehicleId: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/vehicles/${vehicleId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Failed to unlink vehicle (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlink failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
          Vehicles on file ({vehicles.length})
        </h2>
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={busy}>
            + Add vehicle
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>

      {vehicles.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-text-secondary">
          No vehicles linked yet. Most vehicles are captured during a call (Session 4 — Call
          Intake); use Add vehicle here only when you're updating a customer record outside of a tow
          job.
        </p>
      ) : null}

      {vehicles.length > 0 ? (
        <ul className="mt-3 divide-y divide-steel-border overflow-hidden rounded-[10px] border border-steel-border">
          {vehicles.map((v) => (
            <li
              key={v.id}
              className="flex items-start justify-between gap-4 bg-steel-light/30 px-3 py-3 text-sm"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline gap-2 font-medium text-text-primary">
                  <Link href={`/vehicles/${v.id}`} className="hover:text-orange-light">
                    {v.year ?? '—'} {v.make ?? '—'} {v.model ?? ''}
                  </Link>
                  {v.isPrimary ? (
                    <span className="rounded bg-orange/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-orange-light">
                      primary
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
                  {v.plate ? (
                    <span>
                      plate{' '}
                      <span className="text-text-secondary">
                        {v.plate}
                        {v.plateState ? ` / ${v.plateState}` : ''}
                      </span>
                    </span>
                  ) : null}
                  {v.vin ? (
                    <span>
                      VIN …<span className="text-text-secondary">{v.vin.slice(-6)}</span>
                    </span>
                  ) : null}
                  <span>relationship {v.relationship}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleUnlink(v.id)}
                disabled={busy}
                className="text-danger hover:bg-danger/10"
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div
          className={cn(
            'mt-4 space-y-3 rounded-[10px] border border-steel-border bg-steel-light/20 p-4',
            busy && 'opacity-60',
          )}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Year">
              <Input
                type="number"
                placeholder="2020"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </Field>
            <Field label="Make">
              <Input
                placeholder="Honda"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <Input
                placeholder="Civic"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </Field>
            <Field label="Plate">
              <Input
                placeholder="ABC123"
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value })}
              />
            </Field>
            <Field label="State">
              <Input
                placeholder="OH"
                maxLength={2}
                value={form.plateState}
                onChange={(e) => setForm({ ...form, plateState: e.target.value })}
              />
            </Field>
            <Field label="VIN (17 chars)">
              <Input
                placeholder="1HGCM82633A004352"
                maxLength={17}
                className="font-mono"
                value={form.vin}
                onChange={(e) => setForm({ ...form, vin: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Special instructions">
            <textarea
              rows={2}
              placeholder="e.g. AWD, do not flat-tow"
              className="w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 py-2 text-sm text-text-primary"
              value={form.specialInstructions}
              onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })}
            />
          </Field>
          {error ? (
            <div className="rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={busy}>
              {busy ? 'Adding…' : 'Save vehicle'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
