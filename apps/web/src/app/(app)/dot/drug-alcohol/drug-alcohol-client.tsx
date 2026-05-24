'use client';
import { recordDrugTest } from '@/lib/api/dot-client';
import {
  type DotDriverDqViewDto,
  type DotDrugAlcoholTestDto,
  dotDrugAlcoholResultValues,
  dotDrugAlcoholTestTypeValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  tests: DotDrugAlcoholTestDto[];
  drivers: DotDriverDqViewDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const TEST_TYPE_LABELS: Record<(typeof dotDrugAlcoholTestTypeValues)[number], string> = {
  pre_employment: 'Pre-employment',
  random: 'Random',
  reasonable_suspicion: 'Reasonable suspicion',
  post_accident: 'Post-accident',
  return_to_duty: 'Return to duty',
  follow_up: 'Follow-up',
};

const RESULT_TONE: Record<(typeof dotDrugAlcoholResultValues)[number], string> = {
  negative: 'bg-status-success/15 text-status-success',
  positive: 'bg-status-danger/15 text-status-danger',
  refused: 'bg-status-warning/15 text-status-warning',
  cancelled: 'bg-bg-base/60 text-text-secondary-on-dark',
};

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DrugAlcoholClient({ tests, drivers }: Props): JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [driverId, setDriverId] = useState(drivers[0]?.driverId ?? '');
  const [testType, setTestType] = useState<(typeof dotDrugAlcoholTestTypeValues)[number]>('random');
  const [collectedAt, setCollectedAt] = useState('');
  const [result, setResult] = useState<(typeof dotDrugAlcoholResultValues)[number]>('negative');
  const [lab, setLab] = useState('');
  const [notes, setNotes] = useState('');

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!driverId) {
      setError('Select a driver.');
      return;
    }
    if (!collectedAt) {
      setError('Collection date/time is required.');
      return;
    }
    setSubmitting(true);
    try {
      await recordDrugTest({
        driverId,
        testType,
        collectedAt: new Date(collectedAt).toISOString(),
        result,
        ...(lab.trim() ? { lab: lab.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      router.refresh();
      setCollectedAt('');
      setLab('');
      setNotes('');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Record failed.');
      setSubmitting(false);
    }
  }

  const driverName = (id: string): string => {
    const d = drivers.find((x) => x.driverId === id);
    return d ? `${d.firstName} ${d.lastName}` : id;
  };

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drug &amp; Alcohol</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Drug and alcohol test log per 49 CFR Part 382. Log only — no consortium integration this
            release.
          </p>
        </div>
        <Link href="/dot" className="text-accent-orange text-sm">
          ← DOT hub
        </Link>
      </header>

      {/* Test table */}
      <div className="mb-6 bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Driver</th>
              <th className="text-left px-4 py-2.5">Type</th>
              <th className="text-left px-4 py-2.5">Collected</th>
              <th className="text-left px-4 py-2.5">Result</th>
              <th className="text-left px-4 py-2.5">Lab</th>
            </tr>
          </thead>
          <tbody>
            {tests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No test records yet.
                </td>
              </tr>
            )}
            {tests.map((t) => (
              <tr key={t.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5 text-xs font-semibold">{driverName(t.driverId)}</td>
                <td className="px-4 py-2.5 text-xs">{TEST_TYPE_LABELS[t.testType]}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {fmtDatetime(t.collectedAt)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${RESULT_TONE[t.result]}`}
                  >
                    {t.result}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">{t.lab ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Entry form */}
      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
        <h2 className="text-base font-semibold mb-4">Record new test</h2>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label>
              <span className={labelCls}>Driver *</span>
              <select
                className={inputCls}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                required
              >
                <option value="">— Select driver —</option>
                {drivers.map((d) => (
                  <option key={d.driverId} value={d.driverId}>
                    {d.firstName} {d.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Test type *</span>
              <select
                className={inputCls}
                value={testType}
                onChange={(e) =>
                  setTestType(e.target.value as (typeof dotDrugAlcoholTestTypeValues)[number])
                }
              >
                {dotDrugAlcoholTestTypeValues.map((v) => (
                  <option key={v} value={v}>
                    {TEST_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Result *</span>
              <select
                className={inputCls}
                value={result}
                onChange={(e) =>
                  setResult(e.target.value as (typeof dotDrugAlcoholResultValues)[number])
                }
              >
                {dotDrugAlcoholResultValues.map((v) => (
                  <option key={v} value={v} className="capitalize">
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Collected at *</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={collectedAt}
                onChange={(e) => setCollectedAt(e.target.value)}
                required
              />
            </label>
            <label>
              <span className={labelCls}>Lab / MRO</span>
              <input
                className={inputCls}
                value={lab}
                onChange={(e) => setLab(e.target.value)}
                placeholder="Lab name"
                maxLength={200}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelCls}>Notes</span>
            <textarea
              className={`${inputCls} min-h-[72px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={submitting || !driverId}
            className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
          >
            {submitting ? 'Recording…' : 'Record test'}
          </button>
        </form>
      </div>
    </section>
  );
}
