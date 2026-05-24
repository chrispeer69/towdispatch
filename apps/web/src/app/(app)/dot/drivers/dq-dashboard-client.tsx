'use client';
import { recordDqEvent } from '@/lib/api/dot-client';
import { type DotDriverDqViewDto, dotDqFileStatusValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  drivers: DotDriverDqViewDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const STATUS_TONE: Record<(typeof dotDqFileStatusValues)[number], string> = {
  complete: 'bg-status-success/15 text-status-success',
  incomplete: 'bg-status-danger/15 text-status-danger',
  on_hold: 'bg-status-warning/15 text-status-warning',
};

const STATUS_LABEL: Record<(typeof dotDqFileStatusValues)[number], string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  on_hold: 'On hold',
};

function DqUpdateForm({ driver, onDone }: { driver: DotDriverDqViewDto; onDone: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dqFileStatus, setDqFileStatus] = useState<(typeof dotDqFileStatusValues)[number]>(
    driver.dqFileStatus,
  );
  const [employmentAppSignedAt, setEmploymentAppSignedAt] = useState(
    driver.employmentAppSignedAt ? driver.employmentAppSignedAt.slice(0, 10) : '',
  );
  const [mvrPulledAt, setMvrPulledAt] = useState(
    driver.mvrPulledAt ? driver.mvrPulledAt.slice(0, 10) : '',
  );
  const [mvrExpiresAt, setMvrExpiresAt] = useState(
    driver.mvrExpiresAt ? driver.mvrExpiresAt.slice(0, 10) : '',
  );

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await recordDqEvent({
        driverId: driver.driverId,
        dqFileStatus,
        ...(employmentAppSignedAt
          ? { employmentAppSignedAt: new Date(employmentAppSignedAt).toISOString() }
          : { employmentAppSignedAt: null }),
        ...(mvrPulledAt
          ? { mvrPulledAt: new Date(mvrPulledAt).toISOString() }
          : { mvrPulledAt: null }),
        ...(mvrExpiresAt
          ? { mvrExpiresAt: new Date(mvrExpiresAt).toISOString() }
          : { mvrExpiresAt: null }),
      });
      router.refresh();
      onDone();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Update failed.');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 bg-bg-base/40 rounded-md p-4 border border-border-on-dark"
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger"
        >
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label>
          <span className={labelCls}>DQ file status</span>
          <select
            className={inputCls}
            value={dqFileStatus}
            onChange={(e) =>
              setDqFileStatus(e.target.value as (typeof dotDqFileStatusValues)[number])
            }
          >
            {dotDqFileStatusValues.map((v) => (
              <option key={v} value={v}>
                {STATUS_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Employment app signed</span>
          <input
            type="date"
            className={inputCls}
            value={employmentAppSignedAt}
            onChange={(e) => setEmploymentAppSignedAt(e.target.value)}
          />
        </label>
        <label>
          <span className={labelCls}>MVR pulled</span>
          <input
            type="date"
            className={inputCls}
            value={mvrPulledAt}
            onChange={(e) => setMvrPulledAt(e.target.value)}
          />
        </label>
        <label>
          <span className={labelCls}>MVR expires</span>
          <input
            type="date"
            className={inputCls}
            value={mvrExpiresAt}
            onChange={(e) => setMvrExpiresAt(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 rounded-md border border-border-on-dark text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DriverRow({ driver }: { driver: DotDriverDqViewDto }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-border-on-dark">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <div className="flex-1 min-w-[160px]">
          <p className="font-semibold text-sm">
            {driver.firstName} {driver.lastName}
          </p>
          <p className="text-[11px] text-text-secondary-on-dark">
            CDL {driver.cdlClass}
            {driver.employeeNumber ? ` · ${driver.employeeNumber}` : ''}
          </p>
        </div>
        <span
          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[driver.dqFileStatus]}`}
        >
          {STATUS_LABEL[driver.dqFileStatus]}
        </span>
        <div className="flex-1 min-w-[160px]">
          {driver.missing.length > 0 && (
            <p className="text-[11px] text-status-danger">
              Missing: {driver.missing.map((m) => m.replace(/_/g, ' ')).join(', ')}
            </p>
          )}
          {driver.expiring.length > 0 && (
            <p className="text-[11px] text-status-warning">
              Expiring:{' '}
              {driver.expiring
                .map((x) => `${x.item.replace(/_/g, ' ')} (${x.daysLeft}d)`)
                .join(', ')}
            </p>
          )}
          {driver.missing.length === 0 && driver.expiring.length === 0 && (
            <p className="text-[11px] text-status-success">All items current</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="text-accent-orange text-xs"
        >
          {expanded ? 'Close ↑' : 'Update →'}
        </button>
      </div>
      {expanded && <DqUpdateForm driver={driver} onDone={() => setExpanded(false)} />}
    </div>
  );
}

export function DqDashboardClient({ drivers }: Props): JSX.Element {
  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Driver Qualifications</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            DQ file status per driver — license, medical card, MVR, employment app, drug and road
            tests.
          </p>
        </div>
        <Link href="/dot" className="text-accent-orange text-sm">
          ← DOT hub
        </Link>
      </header>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <div className="bg-bg-base/40 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark grid grid-cols-[1fr_auto_1fr_auto] gap-4">
          <span>Driver</span>
          <span>Status</span>
          <span>Items</span>
          <span />
        </div>
        {drivers.length === 0 && (
          <p className="px-4 py-12 text-center text-text-secondary-on-dark">
            No drivers with DQ records yet.
          </p>
        )}
        {drivers.map((d) => (
          <DriverRow key={d.driverId} driver={d} />
        ))}
      </div>
    </section>
  );
}
