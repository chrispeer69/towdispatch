'use client';
import {
  clientCreateRateSheet,
  clientDeleteRateSheet,
  clientUpdateRateSheet,
} from '@/lib/api/heavy-duty-client';
import type {
  CreateHdRateSheetPayload,
  HdRateSheetDto,
  UpdateHdRateSheetPayload,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';
import { formatCents } from '../hd-ui-helpers';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

interface Form {
  name: string;
  hourly: string;
  hookup: string;
  winching: string;
  recovery: string;
  rotator: string;
  mileageLoaded: string;
  mileageDeadhead: string;
  afterHours: string;
  holiday: string;
}

const EMPTY: Form = {
  name: '',
  hourly: '0',
  hookup: '0',
  winching: '0',
  recovery: '0',
  rotator: '0',
  mileageLoaded: '0',
  mileageDeadhead: '0',
  afterHours: '1',
  holiday: '1',
};

const dollarsToCents = (v: string): number => Math.round(Number.parseFloat(v || '0') * 100);

function fromDto(s: HdRateSheetDto): Form {
  return {
    name: s.name,
    hourly: (s.hourlyRateCents / 100).toString(),
    hookup: (s.hookupFeeCents / 100).toString(),
    winching: (s.winchingPerHrCents / 100).toString(),
    recovery: (s.recoveryPerHrCents / 100).toString(),
    rotator: (s.rotatorPerHrCents / 100).toString(),
    mileageLoaded: (s.mileageLoadedCents / 100).toString(),
    mileageDeadhead: (s.mileageDeadheadCents / 100).toString(),
    afterHours: s.afterHoursMultiplier.toString(),
    holiday: s.holidayMultiplier.toString(),
  };
}

export function RateSheetsClient({ initial }: { initial: HdRateSheetDto[] }): JSX.Element {
  const [sheets, setSheets] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function startNew(): void {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }
  function startEdit(s: HdRateSheetDto): void {
    setEditingId(s.id);
    setForm(fromDto(s));
    setError(null);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      hourlyRateCents: dollarsToCents(form.hourly),
      hookupFeeCents: dollarsToCents(form.hookup),
      winchingPerHrCents: dollarsToCents(form.winching),
      recoveryPerHrCents: dollarsToCents(form.recovery),
      rotatorPerHrCents: dollarsToCents(form.rotator),
      mileageLoadedCents: dollarsToCents(form.mileageLoaded),
      mileageDeadheadCents: dollarsToCents(form.mileageDeadhead),
      afterHoursMultiplier: Number.parseFloat(form.afterHours || '1'),
      holidayMultiplier: Number.parseFloat(form.holiday || '1'),
    };
    setBusy(true);
    try {
      if (editingId) {
        const updated = await clientUpdateRateSheet(editingId, body as UpdateHdRateSheetPayload);
        setSheets((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
      } else {
        const created = await clientCreateRateSheet({
          ...body,
          isActive: true,
        } as CreateHdRateSheetPayload);
        setSheets((prev) => [...prev, created]);
      }
      startNew();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this rate sheet?')) return;
    setBusy(true);
    setError(null);
    try {
      await clientDeleteRateSheet(id);
      setSheets((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) startNew();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  const money: { key: keyof Form; label: string }[] = [
    { key: 'hourly', label: 'Hourly rate' },
    { key: 'hookup', label: 'Hook-up fee' },
    { key: 'winching', label: 'Winching / hr' },
    { key: 'recovery', label: 'Recovery / hr' },
    { key: 'rotator', label: 'Rotator / hr' },
    { key: 'mileageLoaded', label: 'Mileage (loaded) / mi' },
    { key: 'mileageDeadhead', label: 'Mileage (deadhead) / mi' },
  ];

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <Link href="/heavy-duty" className="text-accent-orange text-sm">
          ← Back to heavy-duty
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">HD rate sheets</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          Cents-per-unit pricing the on-scene estimate generator draws from. Multipliers scale the
          whole ticket (after-hours / holiday — the higher of the two applies).
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
        >
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Existing sheets */}
        <div className="space-y-2">
          <h2 className="font-semibold">Sheets</h2>
          {sheets.length === 0 && (
            <p className="text-sm text-text-secondary-on-dark">No rate sheets yet.</p>
          )}
          {sheets.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <div className="flex gap-2 text-sm">
                  <button type="button" onClick={() => startEdit(s)} className="text-accent-orange">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={busy}
                    className="text-status-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="text-xs text-text-secondary-on-dark mt-1">
                {formatCents(s.hourlyRateCents)}/hr · hook-up {formatCents(s.hookupFeeCents)} ·
                rotator {formatCents(s.rotatorPerHrCents)}/hr
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <form
          onSubmit={handleSubmit}
          className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4"
        >
          <h2 className="font-semibold">{editingId ? 'Edit rate sheet' : 'New rate sheet'}</h2>
          <label className="block">
            <span className={labelCls}>Name</span>
            <input className={inputCls} value={form.name} onChange={set('name')} maxLength={200} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {money.map((m) => (
              <label key={m.key}>
                <span className={labelCls}>{m.label} (USD)</span>
                <input
                  className={inputCls}
                  value={form[m.key]}
                  onChange={set(m.key)}
                  inputMode="decimal"
                />
              </label>
            ))}
            <label>
              <span className={labelCls}>After-hours ×</span>
              <input
                className={inputCls}
                value={form.afterHours}
                onChange={set('afterHours')}
                inputMode="decimal"
              />
            </label>
            <label>
              <span className={labelCls}>Holiday ×</span>
              <input
                className={inputCls}
                value={form.holiday}
                onChange={set('holiday')}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create rate sheet'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startNew}
                className="px-4 py-2 rounded-md border border-border-on-dark text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
