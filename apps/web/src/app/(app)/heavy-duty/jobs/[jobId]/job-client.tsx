'use client';
import {
  clientFinalizeInvoice,
  clientGenerateEstimate,
  clientGetJobDetail,
  clientMarkJobHd,
} from '@/lib/api/heavy-duty-client';
import {
  type HdIncidentType,
  type HdJobAttributeDto,
  type HdJobDetailDto,
  type HdOnSceneEstimateDto,
  type HdRateSheetDto,
  hdIncidentTypeValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { certTypeLabel, formatCents, gvwrClassLabel, incidentLabel } from '../../hd-ui-helpers';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';
const card = 'rounded-md border border-border-on-dark bg-bg-surface-elevated p-5';
const numOrUndef = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

interface Props {
  jobId: string;
  initialAttributes: HdJobAttributeDto | null;
  rateSheets: HdRateSheetDto[];
}

export function HdJobClient({ jobId, initialAttributes, rateSheets }: Props): JSX.Element {
  const [attrs, setAttrs] = useState(initialAttributes);
  const [detail, setDetail] = useState<HdJobDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mark-HD form
  const [vehicleClass, setVehicleClass] = useState(
    initialAttributes?.vehicleClass != null ? String(initialAttributes.vehicleClass) : '',
  );
  const [gvwr, setGvwr] = useState(
    initialAttributes?.vehicleGvwrLbs != null ? String(initialAttributes.vehicleGvwrLbs) : '',
  );
  const [axles, setAxles] = useState(
    initialAttributes?.vehicleAxleCount != null ? String(initialAttributes.vehicleAxleCount) : '',
  );
  const [incidentType, setIncidentType] = useState<HdIncidentType | ''>(
    initialAttributes?.incidentType ?? '',
  );
  const [cargoType, setCargoType] = useState(initialAttributes?.cargoType ?? '');
  const [requiresRotator, setRequiresRotator] = useState(
    initialAttributes?.requiresRotator ?? false,
  );
  const [requiresHazmat, setRequiresHazmat] = useState(initialAttributes?.requiresHazmat ?? false);
  const [requiresDotReport, setRequiresDotReport] = useState(
    initialAttributes?.requiresDotReport ?? false,
  );
  const [markBusy, setMarkBusy] = useState(false);

  async function loadDetail(): Promise<void> {
    try {
      setDetail(await clientGetJobDetail(jobId));
    } catch {
      // detail 404s only when the job isn't HD yet; ignore quietly.
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — load eligibility once if the job is already HD.
  useEffect(() => {
    if (attrs) void loadDetail();
  }, []);

  async function handleMarkHd(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setMarkBusy(true);
    try {
      const saved = await clientMarkJobHd(jobId, {
        requiresRotator,
        requiresHazmat,
        requiresDotReport,
        ...(numOrUndef(vehicleClass) !== undefined
          ? { vehicleClass: numOrUndef(vehicleClass) }
          : {}),
        ...(numOrUndef(gvwr) !== undefined ? { vehicleGvwrLbs: numOrUndef(gvwr) } : {}),
        ...(numOrUndef(axles) !== undefined ? { vehicleAxleCount: numOrUndef(axles) } : {}),
        ...(incidentType ? { incidentType } : {}),
        ...(cargoType.trim() ? { cargoType: cargoType.trim() } : {}),
      });
      setAttrs(saved);
      await loadDetail();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to mark job heavy-duty.');
    } finally {
      setMarkBusy(false);
    }
  }

  return (
    <section className="max-w-5xl space-y-6">
      <header>
        <Link href="/heavy-duty" className="text-accent-orange text-sm">
          ← Back to heavy-duty
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">HD job ticket</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1 font-mono">{jobId}</p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
        >
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Mark / update HD attributes */}
        <form onSubmit={handleMarkHd} className={`${card} space-y-4`}>
          <h2 className="font-semibold">{attrs ? 'HD attributes' : 'Mark job heavy-duty'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={labelCls}>Vehicle class (1–8)</span>
              <input
                className={inputCls}
                value={vehicleClass}
                onChange={(e) => setVehicleClass(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              <span className={labelCls}>GVWR (lb)</span>
              <input
                className={inputCls}
                value={gvwr}
                onChange={(e) => setGvwr(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              <span className={labelCls}>Axles</span>
              <input
                className={inputCls}
                value={axles}
                onChange={(e) => setAxles(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              <span className={labelCls}>Incident type</span>
              <select
                className={inputCls}
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value as HdIncidentType | '')}
              >
                <option value="">—</option>
                {hdIncidentTypeValues.map((t) => (
                  <option key={t} value={t}>
                    {incidentLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2">
              <span className={labelCls}>Cargo type</span>
              <input
                className={inputCls}
                value={cargoType}
                onChange={(e) => setCargoType(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className={labelCls}>Requirements</legend>
            {[
              { label: 'Requires rotator', v: requiresRotator, set: setRequiresRotator },
              { label: 'Requires HazMat', v: requiresHazmat, set: setRequiresHazmat },
              {
                label: 'Requires DOT report (S37)',
                v: requiresDotReport,
                set: setRequiresDotReport,
              },
            ].map((r) => (
              <label key={r.label} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={r.v} onChange={(e) => r.set(e.target.checked)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={markBusy}
            className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
          >
            {markBusy ? 'Saving…' : attrs ? 'Update attributes' : 'Mark heavy-duty'}
          </button>
          {attrs && (
            <p className="text-xs text-text-secondary-on-dark">
              Class {gvwrClassLabel(attrs.vehicleClass)} ·{' '}
              {attrs.onSceneEstimateCents != null
                ? `estimate ${formatCents(attrs.onSceneEstimateCents)}`
                : 'no estimate yet'}
              {attrs.finalInvoiceCents != null
                ? ` · final ${formatCents(attrs.finalInvoiceCents)}`
                : ''}
            </p>
          )}
        </form>

        {/* Eligibility */}
        <div className={`${card} space-y-4`}>
          <h2 className="font-semibold">Eligibility</h2>
          {!attrs ? (
            <p className="text-sm text-text-secondary-on-dark">
              Mark the job heavy-duty to compute eligible trucks + drivers.
            </p>
          ) : !detail ? (
            <p className="text-sm text-text-secondary-on-dark">Computing…</p>
          ) : (
            <div className="space-y-4">
              <EligibleList
                title="Trucks"
                items={detail.eligibleTrucks.map((t) => ({
                  id: t.truckId,
                  label: t.unitNumber,
                  eligible: t.eligible,
                  reasons: t.reasons,
                }))}
              />
              <EligibleList
                title="Drivers"
                items={detail.eligibleDrivers.map((d) => ({
                  id: d.driverId,
                  label: d.name,
                  eligible: d.eligible,
                  reasons: d.reasons,
                  badges: [...d.missingCerts, ...d.expiredCerts].map(certTypeLabel),
                }))}
              />
            </div>
          )}
        </div>
      </div>

      {attrs && (
        <EstimatePanel
          jobId={jobId}
          rateSheets={rateSheets}
          onPersisted={(c) => setAttrs((a) => (a ? { ...a, onSceneEstimateCents: c } : a))}
        />
      )}

      {attrs && (
        <FinalizePanel
          jobId={jobId}
          current={attrs.finalInvoiceCents}
          onFinalized={(c) => setAttrs((a) => (a ? { ...a, finalInvoiceCents: c } : a))}
        />
      )}
    </section>
  );
}

function EligibleList({
  title,
  items,
}: {
  title: string;
  items: { id: string; label: string; eligible: boolean; reasons: string[]; badges?: string[] }[];
}): JSX.Element {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">None in the HD pool.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="text-sm">
              <span
                className={`inline-block w-2 h-2 rounded-full mr-2 ${i.eligible ? 'bg-status-success' : 'bg-status-danger'}`}
                aria-hidden
              />
              <span className={i.eligible ? '' : 'text-text-secondary-on-dark'}>{i.label}</span>
              {!i.eligible && i.reasons.length > 0 && (
                <span className="text-xs text-text-secondary-on-dark">
                  {' '}
                  — {i.reasons.join('; ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EstimatePanel({
  jobId,
  rateSheets,
  onPersisted,
}: {
  jobId: string;
  rateSheets: HdRateSheetDto[];
  onPersisted: (cents: number) => void;
}): JSX.Element {
  const [rateSheetId, setRateSheetId] = useState(rateSheets[0]?.id ?? '');
  const [labor, setLabor] = useState('0');
  const [winching, setWinching] = useState('0');
  const [recovery, setRecovery] = useState('0');
  const [rotator, setRotator] = useState('0');
  const [loaded, setLoaded] = useState('0');
  const [deadhead, setDeadhead] = useState('0');
  const [includeHookup, setIncludeHookup] = useState(true);
  const [afterHours, setAfterHours] = useState(false);
  const [holiday, setHoliday] = useState(false);
  const [result, setResult] = useState<HdOnSceneEstimateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string): number => {
    const n = Number.parseFloat(v || '0');
    return Number.isFinite(n) ? n : 0;
  };

  async function generate(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!rateSheetId) {
      setError('Create a rate sheet first.');
      return;
    }
    setBusy(true);
    try {
      const est = await clientGenerateEstimate(jobId, {
        rateSheetId,
        laborHours: num(labor),
        winchingHours: num(winching),
        recoveryHours: num(recovery),
        rotatorHours: num(rotator),
        loadedMiles: num(loaded),
        deadheadMiles: num(deadhead),
        includeHookup,
        afterHours,
        holiday,
      });
      setResult(est);
      onPersisted(est.totalCents);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Estimate failed.');
    } finally {
      setBusy(false);
    }
  }

  const hours: { key: string; label: string; v: string; set: (s: string) => void }[] = [
    { key: 'labor', label: 'Labor hrs', v: labor, set: setLabor },
    { key: 'winching', label: 'Winching hrs', v: winching, set: setWinching },
    { key: 'recovery', label: 'Recovery hrs', v: recovery, set: setRecovery },
    { key: 'rotator', label: 'Rotator hrs', v: rotator, set: setRotator },
    { key: 'loaded', label: 'Loaded mi', v: loaded, set: setLoaded },
    { key: 'deadhead', label: 'Deadhead mi', v: deadhead, set: setDeadhead },
  ];

  return (
    <form onSubmit={generate} className={`${card} space-y-4`}>
      <h2 className="font-semibold">On-scene estimate</h2>
      {error && <p className="text-sm text-status-danger">{error}</p>}
      {rateSheets.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">
          No rate sheets.{' '}
          <Link href="/heavy-duty/rate-sheets" className="text-accent-orange">
            Create one
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="col-span-2">
              <span className={labelCls}>Rate sheet</span>
              <select
                className={inputCls}
                value={rateSheetId}
                onChange={(e) => setRateSheetId(e.target.value)}
              >
                {rateSheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {hours.map((h) => (
              <label key={h.key}>
                <span className={labelCls}>{h.label}</span>
                <input
                  className={inputCls}
                  value={h.v}
                  onChange={(e) => h.set(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeHookup}
                onChange={(e) => setIncludeHookup(e.target.checked)}
              />
              Include hook-up
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={afterHours}
                onChange={(e) => setAfterHours(e.target.checked)}
              />
              After hours
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={holiday}
                onChange={(e) => setHoliday(e.target.checked)}
              />
              Holiday
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
          >
            {busy ? 'Calculating…' : 'Generate estimate'}
          </button>

          {result && (
            <div className="rounded-md border border-border-on-dark p-3 text-sm">
              <table className="w-full">
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="py-0.5">
                        {l.label}{' '}
                        <span className="text-text-secondary-on-dark">
                          ({l.quantity} × {formatCents(l.unitCents)})
                        </span>
                      </td>
                      <td className="py-0.5 text-right">{formatCents(l.amountCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border-on-dark">
                    <td className="py-1">Subtotal</td>
                    <td className="py-1 text-right">{formatCents(result.subtotalCents)}</td>
                  </tr>
                  {result.multiplier !== 1 && (
                    <tr>
                      <td className="py-0.5 text-text-secondary-on-dark">Multiplier</td>
                      <td className="py-0.5 text-right text-text-secondary-on-dark">
                        {result.multiplier}×
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-border-on-dark font-semibold">
                    <td className="py-1">Total</td>
                    <td className="py-1 text-right">{formatCents(result.totalCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </form>
  );
}

function FinalizePanel({
  jobId,
  current,
  onFinalized,
}: {
  jobId: string;
  current: number | null;
  onFinalized: (cents: number) => void;
}): JSX.Element {
  const [amount, setAmount] = useState(current != null ? (current / 100).toString() : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function finalize(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setOk(false);
    const cents = Math.round(Number.parseFloat(amount || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a non-negative dollar amount.');
      return;
    }
    setBusy(true);
    try {
      const saved = await clientFinalizeInvoice(jobId, { finalInvoiceCents: cents });
      onFinalized(saved.finalInvoiceCents ?? cents);
      setOk(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Finalize failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={finalize} className={`${card} flex flex-wrap items-end gap-3`}>
      <div>
        <h2 className="font-semibold mb-2">Finalize invoice</h2>
        <label>
          <span className={labelCls}>Final invoice (USD)</span>
          <input
            className={`${inputCls} w-48`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Finalize'}
      </button>
      {ok && <span className="text-sm text-status-success">Saved.</span>}
      {error && <span className="text-sm text-status-danger">{error}</span>}
    </form>
  );
}
