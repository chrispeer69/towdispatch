'use client';
import { getHosWeek, listHos, recordHos } from '@/lib/api/dot-client';
import {
  type DotDriverDqViewDto,
  type DotHosLogDto,
  type DotHosWeekResultDto,
  dotHosStatusValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  drivers: DotDriverDqViewDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const STATUS_LABEL: Record<(typeof dotHosStatusValues)[number], string> = {
  off_duty: 'Off duty',
  sleeper: 'Sleeper berth',
  driving: 'Driving',
  on_duty_not_driving: 'On duty (not driving)',
};

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function HosClient({ drivers }: Props): JSX.Element {
  const [driverId, setDriverId] = useState(drivers[0]?.driverId ?? '');
  const [from, setFrom] = useState(offsetDate(-7));
  const [to, setTo] = useState(offsetDate(0));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weekResult, setWeekResult] = useState<DotHosWeekResultDto | null>(null);
  const [logs, setLogs] = useState<DotHosLogDto[]>([]);

  // Entry form state
  const [entryStatus, setEntryStatus] = useState<(typeof dotHosStatusValues)[number]>('driving');
  const [entryLogDate, setEntryLogDate] = useState(offsetDate(0));
  const [entryStartAt, setEntryStartAt] = useState('');
  const [entryEndAt, setEntryEndAt] = useState('');
  const [entryMiles, setEntryMiles] = useState('');
  const [entryLocation, setEntryLocation] = useState('');
  const [entryRemarks, setEntryRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleLoad(): Promise<void> {
    if (!driverId) return;
    setLoadError(null);
    setLoading(true);
    try {
      const [week, hosLogs] = await Promise.all([
        getHosWeek(driverId, from, to),
        listHos({ driverId, from, to }),
      ]);
      setWeekResult(week);
      setLogs(hosLogs);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load HOS data.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitEntry(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    if (!driverId) {
      setSubmitError('Select a driver first.');
      return;
    }
    if (!entryStartAt) {
      setSubmitError('Start time is required.');
      return;
    }
    setSubmitting(true);
    try {
      await recordHos({
        driverId,
        logDate: entryLogDate,
        status: entryStatus,
        startAt: new Date(entryStartAt).toISOString(),
        ...(entryEndAt ? { endAt: new Date(entryEndAt).toISOString() } : {}),
        ...(entryMiles.trim() ? { milesDriven: Number.parseInt(entryMiles, 10) } : {}),
        ...(entryLocation.trim() ? { locationText: entryLocation.trim() } : {}),
        ...(entryRemarks.trim() ? { remarks: entryRemarks.trim() } : {}),
      });
      // Reload data after entry
      await handleLoad();
      setEntryStartAt('');
      setEntryEndAt('');
      setEntryMiles('');
      setEntryLocation('');
      setEntryRemarks('');
    } catch (e2) {
      setSubmitError(e2 instanceof Error ? e2.message : 'Entry failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hours of Service</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Review weekly totals, violations, and log new HOS entries per 49 CFR 395.
          </p>
        </div>
        <Link href="/dot" className="text-accent-orange text-sm">
          ← DOT hub
        </Link>
      </header>

      {/* Filter bar */}
      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[180px]">
            <span className={labelCls}>Driver</span>
            <select
              className={inputCls}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">— Select driver —</option>
              {drivers.map((d) => (
                <option key={d.driverId} value={d.driverId}>
                  {d.firstName} {d.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[140px]">
            <span className={labelCls}>From</span>
            <input
              type="date"
              className={inputCls}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex-1 min-w-[140px]">
            <span className={labelCls}>To</span>
            <input
              type="date"
              className={inputCls}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={handleLoad}
            disabled={loading || !driverId}
            className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
        {loadError && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger"
          >
            {loadError}
          </div>
        )}
      </div>

      {/* Weekly summary */}
      {weekResult && (
        <div className="mb-6 bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <h2 className="text-base font-semibold mb-3">
            Week summary — {weekResult.from} to {weekResult.to}
          </h2>
          <div className="flex gap-6 text-sm mb-4">
            <div>
              <p className={labelCls}>Total driving</p>
              <p className="font-semibold tabular-nums">
                {fmtMins(weekResult.totalDrivingMinutes)}
              </p>
            </div>
            <div>
              <p className={labelCls}>Total on-duty</p>
              <p className="font-semibold tabular-nums">{fmtMins(weekResult.totalOnDutyMinutes)}</p>
            </div>
            <div>
              <p className={labelCls}>Violations</p>
              <p
                className={`font-semibold ${weekResult.violations.length > 0 ? 'text-status-danger' : 'text-status-success'}`}
              >
                {weekResult.violations.length}
              </p>
            </div>
          </div>
          {weekResult.violations.length > 0 && (
            <div className="space-y-1">
              {weekResult.violations.map((v, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable in-session list
                  key={i}
                  className="flex items-start gap-3 text-sm"
                >
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase shrink-0 ${
                      v.severity === 'violation'
                        ? 'bg-status-danger/15 text-status-danger'
                        : 'bg-status-warning/15 text-status-warning'
                    }`}
                  >
                    {v.severity}
                  </span>
                  <div>
                    <p className="font-medium">{v.rule.replace(/_/g, ' ')}</p>
                    <p className="text-text-secondary-on-dark text-xs">
                      {fmtDatetime(v.at)} — {v.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HOS log table */}
      {logs.length > 0 && (
        <div className="mb-6 bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Start</th>
                <th className="text-left px-4 py-2.5">End</th>
                <th className="text-right px-4 py-2.5">Miles</th>
                <th className="text-left px-4 py-2.5">Location</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">{log.logDate}</td>
                  <td className="px-4 py-2.5 text-xs">{STATUS_LABEL[log.status]}</td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {fmtDatetime(log.startAt)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {log.endAt ? fmtDatetime(log.endAt) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {log.milesDriven ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {log.locationText ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Entry form */}
      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
        <h2 className="text-base font-semibold mb-4">Log new HOS entry</h2>
        {submitError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
          >
            {submitError}
          </div>
        )}
        <form onSubmit={handleSubmitEntry} className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label>
              <span className={labelCls}>Driver</span>
              <select
                className={inputCls}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
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
              <span className={labelCls}>Log date</span>
              <input
                type="date"
                className={inputCls}
                value={entryLogDate}
                onChange={(e) => setEntryLogDate(e.target.value)}
                required
              />
            </label>
            <label>
              <span className={labelCls}>Status</span>
              <select
                className={inputCls}
                value={entryStatus}
                onChange={(e) =>
                  setEntryStatus(e.target.value as (typeof dotHosStatusValues)[number])
                }
              >
                {dotHosStatusValues.map((v) => (
                  <option key={v} value={v}>
                    {STATUS_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Start time *</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={entryStartAt}
                onChange={(e) => setEntryStartAt(e.target.value)}
                required
              />
            </label>
            <label>
              <span className={labelCls}>End time</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={entryEndAt}
                onChange={(e) => setEntryEndAt(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>Miles driven</span>
              <input
                type="number"
                className={inputCls}
                value={entryMiles}
                onChange={(e) => setEntryMiles(e.target.value)}
                min="0"
                max="10000"
                inputMode="numeric"
              />
            </label>
            <label className="col-span-2 md:col-span-3">
              <span className={labelCls}>Location</span>
              <input
                className={inputCls}
                value={entryLocation}
                onChange={(e) => setEntryLocation(e.target.value)}
                placeholder="City, State"
                maxLength={300}
              />
            </label>
            <label className="col-span-2 md:col-span-3">
              <span className={labelCls}>Remarks</span>
              <input
                className={inputCls}
                value={entryRemarks}
                onChange={(e) => setEntryRemarks(e.target.value)}
                maxLength={2000}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting || !driverId}
            className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
          >
            {submitting ? 'Recording…' : 'Record entry'}
          </button>
        </form>
      </div>
    </section>
  );
}
