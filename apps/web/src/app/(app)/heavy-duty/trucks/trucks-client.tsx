'use client';
import { clientSetTruckCapabilities } from '@/lib/api/heavy-duty-client';
import type { HdTruckCapabilityDto, SetHdTruckCapabilitiesPayload } from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useMemo, useState } from 'react';
import { gvwrClassLabel, lbsLabel } from '../hd-ui-helpers';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

interface TruckOpt {
  id: string;
  unitNumber: string;
}

const numOrUndef = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

export function TruckCapabilitiesClient({
  trucks,
  capabilities,
}: {
  trucks: TruckOpt[];
  capabilities: HdTruckCapabilityDto[];
}): JSX.Element {
  const [caps, setCaps] = useState(capabilities);
  const capByTruck = useMemo(() => new Map(caps.map((c) => [c.truckId, c])), [caps]);

  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const current = capByTruck.get(truckId) ?? null;

  const [gvwrClass, setGvwrClass] = useState('');
  const [winch, setWinch] = useState('');
  const [boom, setBoom] = useState('');
  const [axle, setAxle] = useState('');
  const [maxRecovery, setMaxRecovery] = useState('');
  const [hasRotator, setHasRotator] = useState(false);
  const [hasUnderLift, setHasUnderLift] = useState(false);
  const [hasAirCushions, setHasAirCushions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Load the selected truck's existing profile into the form.
  function selectTruck(id: string): void {
    setTruckId(id);
    setOk(false);
    setError(null);
    const c = capByTruck.get(id) ?? null;
    setGvwrClass(c?.gvwrClass != null ? String(c.gvwrClass) : '');
    setWinch(c?.winchCapacityLbs != null ? String(c.winchCapacityLbs) : '');
    setBoom(c?.boomCapacityLbs != null ? String(c.boomCapacityLbs) : '');
    setAxle(c?.axleCount != null ? String(c.axleCount) : '');
    setMaxRecovery(c?.maxRecoveryWeightLbs != null ? String(c.maxRecoveryWeightLbs) : '');
    setHasRotator(c?.hasRotator ?? false);
    setHasUnderLift(c?.hasUnderLift ?? false);
    setHasAirCushions(c?.hasAirCushions ?? false);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!truckId) {
      setError('Select a truck first.');
      return;
    }
    const payload: SetHdTruckCapabilitiesPayload = {
      hasRotator,
      hasUnderLift,
      hasAirCushions,
      ...(numOrUndef(gvwrClass) !== undefined ? { gvwrClass: numOrUndef(gvwrClass) } : {}),
      ...(numOrUndef(winch) !== undefined ? { winchCapacityLbs: numOrUndef(winch) } : {}),
      ...(numOrUndef(boom) !== undefined ? { boomCapacityLbs: numOrUndef(boom) } : {}),
      ...(numOrUndef(axle) !== undefined ? { axleCount: numOrUndef(axle) } : {}),
      ...(numOrUndef(maxRecovery) !== undefined
        ? { maxRecoveryWeightLbs: numOrUndef(maxRecovery) }
        : {}),
    };
    setBusy(true);
    try {
      const saved = await clientSetTruckCapabilities(truckId, payload);
      setCaps((prev) => {
        const others = prev.filter((c) => c.truckId !== truckId);
        return [...others, saved];
      });
      setOk(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  const unitFor = (id: string): string => trucks.find((t) => t.id === id)?.unitNumber ?? id;

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <Link href="/heavy-duty" className="text-accent-orange text-sm">
          ← Back to heavy-duty
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Truck capabilities</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          The HD profile dispatch eligibility filters on. Saving a profile marks the truck
          heavy-duty capable.
        </p>
      </header>

      {trucks.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">
          No trucks found. Add trucks under{' '}
          <Link href="/fleet" className="text-accent-orange">
            Trucks/Drivers
          </Link>{' '}
          first.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <form
            onSubmit={handleSubmit}
            className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4"
          >
            {error && (
              <div
                role="alert"
                className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger"
              >
                {error}
              </div>
            )}
            {ok && (
              <div className="rounded-md border border-status-success/40 bg-status-success/10 px-3 py-2 text-sm text-status-success">
                Capabilities saved.
              </div>
            )}
            <label className="block">
              <span className={labelCls}>Truck</span>
              <select
                className={inputCls}
                value={truckId}
                onChange={(e) => selectTruck(e.target.value)}
              >
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.unitNumber}
                    {capByTruck.has(t.id) ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={labelCls}>GVWR class (3–8)</span>
                <input
                  className={inputCls}
                  value={gvwrClass}
                  onChange={(e) => setGvwrClass(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                <span className={labelCls}>Axles</span>
                <input
                  className={inputCls}
                  value={axle}
                  onChange={(e) => setAxle(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                <span className={labelCls}>Winch capacity (lb)</span>
                <input
                  className={inputCls}
                  value={winch}
                  onChange={(e) => setWinch(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                <span className={labelCls}>Boom capacity (lb)</span>
                <input
                  className={inputCls}
                  value={boom}
                  onChange={(e) => setBoom(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="col-span-2">
                <span className={labelCls}>Max recovery weight (lb)</span>
                <input
                  className={inputCls}
                  value={maxRecovery}
                  onChange={(e) => setMaxRecovery(e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className={labelCls}>Equipment</legend>
              {[
                { label: 'Rotator', v: hasRotator, set: setHasRotator },
                { label: 'Under-lift', v: hasUnderLift, set: setHasUnderLift },
                { label: 'Air cushions', v: hasAirCushions, set: setHasAirCushions },
              ].map((eq) => (
                <label key={eq.label} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={eq.v}
                    onChange={(e) => eq.set(e.target.checked)}
                  />
                  {eq.label}
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy ? 'Saving…' : current ? 'Update capabilities' : 'Set capabilities'}
            </button>
          </form>

          <div className="space-y-2">
            <h2 className="font-semibold">HD-equipped trucks</h2>
            {caps.length === 0 ? (
              <p className="text-sm text-text-secondary-on-dark">No capability profiles yet.</p>
            ) : (
              caps.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => selectTruck(c.truckId)}
                  className="block w-full text-left rounded-md border border-border-on-dark bg-bg-surface-elevated p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{unitFor(c.truckId)}</span>
                    <span className="text-text-secondary-on-dark">
                      {gvwrClassLabel(c.gvwrClass)}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary-on-dark mt-1">
                    {c.hasRotator ? 'Rotator - ' : ''}max recovery{' '}
                    {lbsLabel(c.maxRecoveryWeightLbs)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
