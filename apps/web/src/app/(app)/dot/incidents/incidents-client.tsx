'use client';
import { recordIncident } from '@/lib/api/dot-client';
import {
  type DotDriverDqViewDto,
  type DotIncidentReportDto,
  dotIncidentSeverityValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  incidents: DotIncidentReportDto[];
  drivers: DotDriverDqViewDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const SEVERITY_LABELS: Record<(typeof dotIncidentSeverityValues)[number], string> = {
  property_damage: 'Property damage',
  injury: 'Injury',
  fatality: 'Fatality',
};

const SEVERITY_TONE: Record<(typeof dotIncidentSeverityValues)[number], string> = {
  property_damage: 'bg-status-warning/15 text-status-warning',
  injury: 'bg-status-danger/15 text-status-danger',
  fatality: 'bg-status-danger/30 text-status-danger font-bold',
};

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function IncidentsClient({ incidents, drivers }: Props): JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [occurredAt, setOccurredAt] = useState('');
  const [driverId, setDriverId] = useState('');
  const [severity, setSeverity] =
    useState<(typeof dotIncidentSeverityValues)[number]>('property_damage');
  const [fatalities, setFatalities] = useState('0');
  const [injuries, setInjuries] = useState('0');
  const [hazmatRelease, setHazmatRelease] = useState(false);
  const [towedAway, setTowedAway] = useState(false);
  const [locationText, setLocationText] = useState('');
  const [narrative, setNarrative] = useState('');

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!occurredAt) {
      setError('Date and time of occurrence is required.');
      return;
    }
    setSubmitting(true);
    try {
      await recordIncident({
        occurredAt: new Date(occurredAt).toISOString(),
        severity,
        fatalities: Number.parseInt(fatalities || '0', 10),
        injuries: Number.parseInt(injuries || '0', 10),
        hazmatRelease,
        towedAway,
        ...(driverId ? { driverId } : {}),
        ...(locationText.trim() ? { locationText: locationText.trim() } : {}),
        ...(narrative.trim() ? { narrative: narrative.trim() } : {}),
      });
      router.refresh();
      setOccurredAt('');
      setDriverId('');
      setSeverity('property_damage');
      setFatalities('0');
      setInjuries('0');
      setHazmatRelease(false);
      setTowedAway(false);
      setLocationText('');
      setNarrative('');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Record failed.');
      setSubmitting(false);
    }
  }

  const driverName = (id: string | null): string => {
    if (!id) return '—';
    const d = drivers.find((x) => x.driverId === id);
    return d ? `${d.firstName} ${d.lastName}` : id;
  };

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Incidents</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Accident register per 49 CFR 390.15. DOT-reportable determination is automatic based on
            severity.
          </p>
        </div>
        <Link href="/dot" className="text-accent-orange text-sm">
          ← DOT hub
        </Link>
      </header>

      {/* Incident table */}
      <div className="mb-6 bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Occurred</th>
              <th className="text-left px-4 py-2.5">Driver</th>
              <th className="text-left px-4 py-2.5">Severity</th>
              <th className="text-right px-4 py-2.5">Fatalities</th>
              <th className="text-right px-4 py-2.5">Injuries</th>
              <th className="text-left px-4 py-2.5">Flags</th>
              <th className="text-left px-4 py-2.5">DOT</th>
            </tr>
          </thead>
          <tbody>
            {incidents.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No incidents on record.
                </td>
              </tr>
            )}
            {incidents.map((inc) => (
              <tr key={inc.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {fmtDatetime(inc.occurredAt)}
                  {inc.locationText && (
                    <div className="text-[11px] text-text-secondary-on-dark">
                      {inc.locationText}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs">{driverName(inc.driverId)}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${SEVERITY_TONE[inc.severity]}`}
                  >
                    {SEVERITY_LABELS[inc.severity]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">{inc.fatalities}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">{inc.injuries}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {inc.hazmatRelease && <span className="text-status-danger mr-1">Hazmat</span>}
                  {inc.towedAway && <span className="text-status-warning">Towed</span>}
                  {!inc.hazmatRelease && !inc.towedAway && '—'}
                </td>
                <td className="px-4 py-2.5">
                  {inc.dotReportable ? (
                    <span className="text-[11px] font-semibold uppercase text-status-danger">
                      Yes
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-secondary-on-dark">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Entry form */}
      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
        <h2 className="text-base font-semibold mb-4">Record new incident</h2>
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
              <span className={labelCls}>Occurred at *</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
              />
            </label>
            <label>
              <span className={labelCls}>Driver (optional)</span>
              <select
                className={inputCls}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">— None —</option>
                {drivers.map((d) => (
                  <option key={d.driverId} value={d.driverId}>
                    {d.firstName} {d.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Severity *</span>
              <select
                className={inputCls}
                value={severity}
                onChange={(e) =>
                  setSeverity(e.target.value as (typeof dotIncidentSeverityValues)[number])
                }
              >
                {dotIncidentSeverityValues.map((v) => (
                  <option key={v} value={v}>
                    {SEVERITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Fatalities</span>
              <input
                type="number"
                className={inputCls}
                value={fatalities}
                onChange={(e) => setFatalities(e.target.value)}
                min="0"
                max="1000"
                inputMode="numeric"
              />
            </label>
            <label>
              <span className={labelCls}>Injuries</span>
              <input
                type="number"
                className={inputCls}
                value={injuries}
                onChange={(e) => setInjuries(e.target.value)}
                min="0"
                max="1000"
                inputMode="numeric"
              />
            </label>
            <label className="col-span-2 md:col-span-3">
              <span className={labelCls}>Location</span>
              <input
                className={inputCls}
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="City, State, Highway"
                maxLength={300}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={hazmatRelease}
                onChange={(e) => setHazmatRelease(e.target.checked)}
                className="rounded"
              />
              <span>Hazmat release</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={towedAway}
                onChange={(e) => setTowedAway(e.target.checked)}
                className="rounded"
              />
              <span>Vehicle towed away</span>
            </label>
          </div>
          <label className="block">
            <span className={labelCls}>Narrative</span>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Description of the incident…"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
          >
            {submitting ? 'Recording…' : 'Record incident'}
          </button>
        </form>
      </div>
    </section>
  );
}
