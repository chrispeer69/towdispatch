'use client';
import { useUser } from '@/components/app-shell/session-provider';
import {
  clientLogChargeStop,
  clientMarkJobEv,
  clientRecordIntake,
  clientReportThermalEvent,
} from '@/lib/api/ev-client';
import {
  bilingualThermalWarning,
  chemistryLabel,
  equipmentBadge,
  escalationActions,
  formatCents,
  formatKwh,
  severityLabel,
  socTone,
} from '@/lib/ev/ev-ui-helpers';
import type {
  EvJobDetailDto,
  LogChargeStopPayload,
  MarkJobEvPayload,
  RecordEvIntakePayload,
} from '@ustowdispatch/shared';
import {
  evBatteryChemistryValues,
  evChargePaidByValues,
  evThermalSeverityValues,
} from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const TONE_CLASS: Record<string, string> = {
  danger: 'bg-status-danger/15 text-status-danger border-status-danger/40',
  warn: 'bg-status-warning/15 text-status-warning border-status-warning/40',
  ok: 'bg-bg-surface-elevated text-text-secondary-on-dark border-border-on-dark',
};
const INPUT = 'rounded border border-border-on-dark bg-bg-surface-elevated px-2 py-1 text-sm';
const BTN =
  'px-3 py-1.5 rounded bg-accent-orange text-white text-sm font-semibold disabled:opacity-50';

export function EvJobClient({
  jobId,
  initialDetail,
}: {
  jobId: string;
  initialDetail: EvJobDetailDto | null;
}): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!initialDetail) {
    return (
      <div className="space-y-4">
        {error && <ErrorBar message={error} />}
        <div className="rounded-md border border-border-on-dark p-4">
          <p className="text-sm text-text-secondary-on-dark">
            This job is not yet marked as an EV recovery.
          </p>
          {canWrite && (
            <MarkEvForm busy={busy} onSubmit={(body) => run(() => clientMarkJobEv(jobId, body))} />
          )}
        </div>
      </div>
    );
  }

  const d = initialDetail;
  const badge = equipmentBadge(d.equipment);
  const activeThermal = d.thermalEvents[0] ?? null;

  return (
    <div className="space-y-6">
      {error && <ErrorBar message={error} />}

      {/* Equipment badge + reasons */}
      <div className="rounded-md border border-border-on-dark p-4 space-y-2">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block px-3 py-1 rounded text-sm font-bold uppercase border ${TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
          {d.equipment.hvIsolationRequired && (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase border border-status-danger/40 text-status-danger">
              Isolate HV
            </span>
          )}
        </div>
        <ul className="text-sm text-text-secondary-on-dark list-disc pl-5">
          {d.equipment.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      {/* Active thermal warning (bilingual) */}
      {activeThermal && <ThermalWarning detail={d} />}

      {/* Intake panel */}
      <IntakePanel
        detail={d}
        canWrite={canWrite}
        busy={busy}
        onSave={(body) => run(() => clientRecordIntake(jobId, body))}
      />

      {/* OEM procedure card */}
      <OemCard detail={d} />

      {/* Thermal event reporter */}
      <ThermalSection
        detail={d}
        canWrite={canWrite}
        busy={busy}
        onReport={(severity) => run(() => clientReportThermalEvent(jobId, { severity }))}
      />

      {/* Charge stops */}
      <ChargeSection
        detail={d}
        canWrite={canWrite}
        busy={busy}
        onLog={(body) => run(() => clientLogChargeStop(jobId, body))}
      />
    </div>
  );
}

function ErrorBar({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
      {message}
    </div>
  );
}

function MarkEvForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: MarkJobEvPayload) => void;
}): JSX.Element {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  function submit(): void {
    const body: MarkJobEvPayload = {};
    if (make) body.make = make;
    if (model) body.model = model;
    if (year) body.modelYear = Number(year);
    onSubmit(body);
  }
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Field label="Make">
        <input className={INPUT} value={make} onChange={(e) => setMake(e.target.value)} />
      </Field>
      <Field label="Model">
        <input className={INPUT} value={model} onChange={(e) => setModel(e.target.value)} />
      </Field>
      <Field label="Year">
        <input
          className={`${INPUT} w-24`}
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </Field>
      <button type="button" disabled={busy} className={BTN} onClick={submit}>
        Mark as EV recovery
      </button>
    </div>
  );
}

function IntakePanel({
  detail,
  canWrite,
  busy,
  onSave,
}: {
  detail: EvJobDetailDto;
  canWrite: boolean;
  busy: boolean;
  onSave: (body: RecordEvIntakePayload) => void;
}): JSX.Element {
  const a = detail.attributes;
  const [soc, setSoc] = useState(a.stateOfChargePct?.toString() ?? '');
  const [chem, setChem] = useState<string>(a.batteryChemistry ?? '');
  const [hvIsolated, setHvIsolated] = useState(a.hvIsolated);
  const [towMode, setTowMode] = useState(a.towModeEngaged);
  const [portLocked, setPortLocked] = useState(a.chargePortLocked);
  const [oemAck, setOemAck] = useState(a.oemTowProcedureAcknowledged);
  function save(): void {
    const body: RecordEvIntakePayload = {
      hvIsolated,
      towModeEngaged: towMode,
      chargePortLocked: portLocked,
      oemTowProcedureAcknowledged: oemAck,
    };
    if (soc) body.stateOfChargePct = Number(soc);
    if (chem) body.batteryChemistry = chem as RecordEvIntakePayload['batteryChemistry'];
    onSave(body);
  }

  return (
    <div className="rounded-md border border-border-on-dark p-4 space-y-3">
      <h2 className="font-semibold">Charge-state &amp; safety intake</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Make / model">
          <span>
            {a.make ?? '—'} {a.model ?? ''} {a.modelYear ?? ''}
          </span>
        </Field>
        <Field label="Battery">
          <span>{chemistryLabel(a.batteryChemistry)}</span>
        </Field>
        <Field label="State of charge (%)">
          <input
            className={`${INPUT} ${socTone(a.stateOfChargePct) === 'danger' ? 'border-status-danger' : ''}`}
            inputMode="numeric"
            value={soc}
            disabled={!canWrite}
            onChange={(e) => setSoc(e.target.value)}
          />
        </Field>
        <Field label="Chemistry">
          <select
            className={INPUT}
            value={chem}
            disabled={!canWrite}
            onChange={(e) => setChem(e.target.value)}
          >
            <option value="">—</option>
            {evBatteryChemistryValues.map((c) => (
              <option key={c} value={c}>
                {chemistryLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Check
          label="HV isolated"
          checked={hvIsolated}
          disabled={!canWrite}
          onChange={setHvIsolated}
        />
        <Check
          label="Tow mode engaged"
          checked={towMode}
          disabled={!canWrite}
          onChange={setTowMode}
        />
        <Check
          label="Charge port locked"
          checked={portLocked}
          disabled={!canWrite}
          onChange={setPortLocked}
        />
        <Check
          label="OEM procedure acknowledged"
          checked={oemAck}
          disabled={!canWrite}
          onChange={setOemAck}
        />
      </div>
      {canWrite && (
        <button type="button" disabled={busy} className={BTN} onClick={save}>
          Save intake
        </button>
      )}
    </div>
  );
}

function OemCard({ detail }: { detail: EvJobDetailDto }): JSX.Element {
  const p = detail.oemProcedure;
  if (!p) {
    return (
      <div className="rounded-md border border-border-on-dark p-4">
        <h2 className="font-semibold">OEM tow procedure</h2>
        <p className="text-sm text-text-secondary-on-dark mt-1">
          No OEM-specific procedure on file for this vehicle. Default to flatbed-only and consult
          the manufacturer service manual / first-responder guide before loading.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border-on-dark p-4 space-y-3">
      <h2 className="font-semibold">
        OEM tow procedure — {p.make} {p.model ?? ''}
      </h2>
      <div className="text-sm space-y-2">
        <div>
          <p className="font-medium">Tow-mode steps</p>
          <p className="text-text-secondary-on-dark whitespace-pre-line">{p.towModeSteps}</p>
        </div>
        <div>
          <p className="font-medium">HV disconnect steps</p>
          <p className="text-text-secondary-on-dark whitespace-pre-line">{p.hvDisconnectSteps}</p>
        </div>
        <div className="flex gap-4">
          {p.jackingPointsUrl && (
            <a
              className="text-accent-orange"
              href={p.jackingPointsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Jacking points ↗
            </a>
          )}
          {p.officialDocUrl && (
            <a
              className="text-accent-orange"
              href={p.officialDocUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official OEM doc ↗
            </a>
          )}
        </div>
      </div>
      <p className="text-[11px] text-text-secondary-on-dark">
        Best-effort summary, last verified {p.lastVerifiedAt.slice(0, 10)}. VERIFY against the
        current OEM service manual before relying on these steps.
      </p>
    </div>
  );
}

function ThermalWarning({ detail }: { detail: EvJobDetailDto }): JSX.Element {
  const ev = detail.thermalEvents[0];
  if (!ev) return <></>;
  const warn = bilingualThermalWarning(ev.escalation);
  return (
    <div className="rounded-md border-2 border-status-danger bg-status-danger/10 px-4 py-3 space-y-2">
      <p className="font-bold text-status-danger uppercase text-sm">
        Thermal event: {severityLabel(ev.severity)}
      </p>
      <p className="text-sm">{warn.en}</p>
      <p className="text-sm italic text-text-secondary-on-dark">{warn.es}</p>
      <ul className="text-sm list-disc pl-5">
        {escalationActions(ev.escalation).map((act) => (
          <li key={act}>{act}</li>
        ))}
      </ul>
    </div>
  );
}

function ThermalSection({
  detail,
  canWrite,
  busy,
  onReport,
}: {
  detail: EvJobDetailDto;
  canWrite: boolean;
  busy: boolean;
  onReport: (severity: (typeof evThermalSeverityValues)[number]) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);
  return (
    <div className="rounded-md border border-border-on-dark p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Thermal events</h2>
        {canWrite &&
          (picking ? (
            <div className="flex flex-wrap gap-1">
              {evThermalSeverityValues.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  className="px-2 py-1 rounded text-xs border border-status-danger/50 text-status-danger"
                  onClick={() => {
                    setPicking(false);
                    onReport(s);
                  }}
                >
                  {severityLabel(s)}
                </button>
              ))}
              <button type="button" className="px-2 py-1 text-xs" onClick={() => setPicking(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-status-danger text-white text-sm font-semibold"
              onClick={() => setPicking(true)}
            >
              ⚠ Report thermal event
            </button>
          ))}
      </div>
      {detail.thermalEvents.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">None reported.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {detail.thermalEvents.map((ev) => (
            <li key={ev.id} className="flex justify-between">
              <span>
                {severityLabel(ev.severity)} - {ev.observedAt.slice(0, 16).replace('T', ' ')}
              </span>
              <span className="text-text-secondary-on-dark">
                {ev.fireDeptCalled ? 'FD-' : ''}
                {ev.hazmatCalled ? 'Hazmat-' : ''}
                {ev.customerEvacuated ? 'Evac' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChargeSection({
  detail,
  canWrite,
  busy,
  onLog,
}: {
  detail: EvJobDetailDto;
  canWrite: boolean;
  busy: boolean;
  onLog: (body: LogChargeStopPayload) => void;
}): JSX.Element {
  const [network, setNetwork] = useState('');
  const [kwh, setKwh] = useState('');
  const [cost, setCost] = useState('');
  const [paidBy, setPaidBy] = useState<(typeof evChargePaidByValues)[number]>('tenant');
  function log(): void {
    const body: LogChargeStopPayload = { paidBy };
    if (network) body.stationNetwork = network;
    if (kwh) body.kwhDelivered = Number(kwh);
    if (cost) body.costCents = Math.round(Number(cost) * 100);
    onLog(body);
  }

  return (
    <div className="rounded-md border border-border-on-dark p-4 space-y-3">
      <h2 className="font-semibold">Charge stops</h2>
      {detail.chargeStops.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">None logged.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {detail.chargeStops.map((s) => (
            <li key={s.id} className="flex justify-between">
              <span>{s.stationNetwork ?? 'Charge stop'}</span>
              <span className="text-text-secondary-on-dark">
                {formatKwh(s.kwhDelivered)} - {formatCents(s.costCents)} - {s.paidBy}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Network">
            <input className={INPUT} value={network} onChange={(e) => setNetwork(e.target.value)} />
          </Field>
          <Field label="kWh">
            <input
              className={`${INPUT} w-20`}
              inputMode="decimal"
              value={kwh}
              onChange={(e) => setKwh(e.target.value)}
            />
          </Field>
          <Field label="Cost ($)">
            <input
              className={`${INPUT} w-24`}
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
          <Field label="Paid by">
            <select
              className={INPUT}
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value as typeof paidBy)}
            >
              {evChargePaidByValues.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" disabled={busy} className={BTN} onClick={log}>
            Log charge stop
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: { label: string; children: JSX.Element | string }): JSX.Element {
  // A plain div (not <label>): the Field wraps both inputs and read-only
  // display spans, so an implicit label association would be wrong.
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-text-secondary-on-dark text-xs uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
