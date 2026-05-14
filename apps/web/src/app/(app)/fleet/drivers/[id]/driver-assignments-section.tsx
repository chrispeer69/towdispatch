'use client';

import { Button } from '@/components/ui/button';
import type { DriverTruckAssignmentDto, TruckDto } from '@ustowdispatch/shared';
import { useState } from 'react';

interface Props {
  driverId: string;
  initial: DriverTruckAssignmentDto[];
  trucks: TruckDto[];
}

export function DriverAssignmentsSection({ driverId, initial, trucks }: Props): JSX.Element {
  const [assignments, setAssignments] = useState<DriverTruckAssignmentDto[]>(initial);
  const [truckId, setTruckId] = useState<string>(trucks[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    if (!truckId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, truckId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(j?.message ?? 'Assignment failed.');
        return;
      }
      const created = (await res.json()) as DriverTruckAssignmentDto;
      setAssignments((prev) => (prev.some((a) => a.id === created.id) ? prev : [...prev, created]));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/fleet/assignments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="driver-assignments-section">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
        Assigned trucks
      </h3>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-[12px] border border-steel-border bg-steel-mid p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-secondary" htmlFor="assign-truck">
            Truck
          </label>
          <select
            id="assign-truck"
            value={truckId}
            onChange={(e) => setTruckId(e.target.value)}
            data-testid="driver-assign-truck-select"
            className="rounded-[8px] border border-steel-border bg-steel px-3 py-2 text-sm"
          >
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unitNumber}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={() => void add()}
          disabled={busy || !truckId}
          data-testid="driver-assign-truck-button"
        >
          Assign truck
        </Button>
        {error ? <span className="text-sm text-red-400">{error}</span> : null}
      </div>

      {assignments.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No truck assignments yet.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm" data-testid="driver-assignments-list">
          {assignments.map((a) => {
            const truck = trucks.find((t) => t.id === a.truckId);
            return (
              <li key={a.id} className="flex items-center justify-between">
                <span>{truck?.unitNumber ?? a.truckId.slice(0, 8)}</span>
                <button
                  type="button"
                  onClick={() => void remove(a.id)}
                  disabled={busy}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
