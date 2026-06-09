'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type DriverDto,
  type DvirDefect,
  type DvirDto,
  type TruckDto,
  dvirDefectSeverityValues,
  dvirTypeValues,
} from '@towdispatch/shared';
import { useState } from 'react';

interface Props {
  trucks: TruckDto[];
  drivers: DriverDto[];
}

export function DvirSubmitClient({ trucks, drivers }: Props): JSX.Element {
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? '');
  const [truckId, setTruckId] = useState(trucks[0]?.id ?? '');
  const [type, setType] = useState<(typeof dvirTypeValues)[number]>('pre_trip');
  const [odometer, setOdometer] = useState<string>('');
  // Stable per-row id keeps React keys correct when the user reorders or
  // removes defect rows. Bumped on every addDefect call.
  const [defects, setDefects] = useState<Array<DvirDefect & { uid: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addDefect(): void {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDefects((prev) => [...prev, { uid, component: '', severity: 'minor' }]);
  }

  function updateDefect(idx: number, patch: Partial<DvirDefect>): void {
    setDefects((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function removeDefect(idx: number): void {
    setDefects((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(): Promise<void> {
    if (!driverId || !truckId) {
      setError('Driver and truck are required.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/fleet/dvirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          truckId,
          type,
          ...(odometer ? { odometerReading: Number(odometer) } : {}),
          defects: defects
            .filter((d) => d.component.trim().length > 0)
            .map(({ uid: _uid, ...rest }) => rest),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(j?.message ?? 'Submit failed.');
        return;
      }
      const created = (await res.json()) as DvirDto;
      setSuccess(`DVIR ${created.id.slice(0, 8)}… submitted (${created.status}).`);
      setDefects([]);
      setOdometer('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="dvir-submit-section">
      <h2 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
        Submit DVIR
      </h2>
      <div className="mt-3 grid gap-3 rounded-[12px] border border-divider bg-bg-surface p-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="dvir-driver">Driver</Label>
          <select
            id="dvir-driver"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            data-testid="dvir-driver-select"
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2 text-sm"
          >
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.lastName}, {d.firstName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dvir-truck">Truck</Label>
          <select
            id="dvir-truck"
            value={truckId}
            onChange={(e) => setTruckId(e.target.value)}
            data-testid="dvir-truck-select"
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2 text-sm"
          >
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unitNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dvir-type">Type</Label>
          <select
            id="dvir-type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof dvirTypeValues)[number])}
            className="rounded-[8px] border border-divider bg-bg-base px-3 py-2 text-sm"
          >
            {dvirTypeValues.map((v) => (
              <option key={v} value={v}>
                {v.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dvir-odometer">Odometer</Label>
          <Input
            id="dvir-odometer"
            type="number"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            data-testid="dvir-odometer"
          />
        </div>
        <div className="md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark-on-dark/60">
              Defects
            </h3>
            <button
              type="button"
              onClick={addDefect}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-primary hover:text-brand-primary"
              data-testid="dvir-add-defect"
            >
              + Add defect
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {defects.map((d, i) => (
              <li key={d.uid} className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Component (e.g. Brakes)"
                  aria-label={`Defect ${i + 1} component`}
                  value={d.component}
                  onChange={(e) => updateDefect(i, { component: e.target.value })}
                  className="flex-1 min-w-[200px]"
                  data-testid={`dvir-defect-component-${i}`}
                />
                <select
                  aria-label={`Defect ${i + 1} severity`}
                  value={d.severity}
                  onChange={(e) =>
                    updateDefect(i, {
                      severity: e.target.value as DvirDefect['severity'],
                    })
                  }
                  data-testid={`dvir-defect-severity-${i}`}
                  className="rounded-[8px] border border-divider bg-bg-base px-2 py-1 text-sm"
                >
                  {dvirDefectSeverityValues.map((v) => (
                    <option key={v} value={v}>
                      {v.replace('_', ' ')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeDefect(i)}
                  aria-label={`Remove defect ${i + 1}`}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60 hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="dvir-submit-button"
          >
            Submit DVIR
          </Button>
          {error ? (
            <span role="alert" aria-live="assertive" className="ml-3 text-sm text-red-400">
              {error}
            </span>
          ) : null}
          {success ? (
            <output
              aria-live="polite"
              className="ml-3 text-sm text-emerald-300"
              data-testid="dvir-success"
            >
              {success}
            </output>
          ) : null}
        </div>
      </div>
    </section>
  );
}
