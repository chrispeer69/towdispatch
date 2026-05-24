'use client';
import { clientCreateYard, clientIntakeRecord } from '@/lib/api/impound-client';
import type {
  CreateImpoundRecordPayload,
  CreateImpoundYardPayload,
  ImpoundYardDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  yards: ImpoundYardDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

export function ImpoundIntakeClient({ yards: initialYards }: Props): JSX.Element {
  const router = useRouter();
  const [yards, setYards] = useState(initialYards);
  const [yardId, setYardId] = useState(initialYards[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vehicle fields
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [vin, setVin] = useState('');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('');
  const [dailyFee, setDailyFee] = useState('35.00');
  const [mileage, setMileage] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');

  // Inline new-yard form (shown when no yards exist or operator expands it)
  const [showYardForm, setShowYardForm] = useState(initialYards.length === 0);
  const [yardName, setYardName] = useState('');
  const [yardCode, setYardCode] = useState('');
  const [yardBusy, setYardBusy] = useState(false);

  async function handleCreateYard(): Promise<void> {
    setError(null);
    if (!yardName.trim() || !yardCode.trim()) {
      setError('Yard name and code are required.');
      return;
    }
    setYardBusy(true);
    try {
      const payload: CreateImpoundYardPayload = {
        name: yardName.trim(),
        code: yardCode.trim(),
        isActive: true,
      };
      const created = await clientCreateYard(payload);
      setYards((prev) => [...prev, created]);
      setYardId(created.id);
      setShowYardForm(false);
      setYardName('');
      setYardCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create yard.');
    } finally {
      setYardBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!yardId) {
      setError('Select or create a yard first.');
      return;
    }
    const feeCents = Math.round(Number.parseFloat(dailyFee || '0') * 100);
    if (!Number.isFinite(feeCents) || feeCents < 0) {
      setError('Daily fee must be a non-negative dollar amount.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateImpoundRecordPayload = {
        yardId,
        dailyFeeCents: feeCents,
        intakePhotoKeys: [],
        ...(make.trim() ? { vehicleMake: make.trim() } : {}),
        ...(model.trim() ? { vehicleModel: model.trim() } : {}),
        ...(year.trim() ? { vehicleYear: Number.parseInt(year, 10) } : {}),
        ...(color.trim() ? { vehicleColor: color.trim() } : {}),
        ...(vin.trim() ? { vehicleVin: vin.trim() } : {}),
        ...(plate.trim() ? { licensePlate: plate.trim() } : {}),
        ...(plateState.trim() ? { licenseState: plateState.trim() } : {}),
        ...(mileage.trim() ? { intakeMileage: Number.parseInt(mileage, 10) } : {}),
        ...(conditionNotes.trim() ? { conditionNotes: conditionNotes.trim() } : {}),
      };
      const record = await clientIntakeRecord(payload);
      router.push(`/impound/${record.id}`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Intake failed.');
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <header className="mb-6">
        <Link href="/impound" className="text-accent-orange text-sm">
          ← Back to impound
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">New vehicle intake</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          Record a vehicle arriving in storage. The daily storage clock starts on intake.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <legend className="px-1 text-sm font-semibold">Yard</legend>
          {yards.length > 0 && !showYardForm && (
            <div className="flex items-end gap-3">
              <label className="flex-1">
                <span className={labelCls}>Storage yard</span>
                <select
                  value={yardId}
                  onChange={(e) => setYardId(e.target.value)}
                  className={inputCls}
                >
                  {yards.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setShowYardForm(true)}
                className="px-3 py-2 rounded-md border border-border-on-dark text-sm text-text-secondary-on-dark"
              >
                + New yard
              </button>
            </div>
          )}
          {showYardForm && (
            <div className="space-y-3">
              {yards.length === 0 && (
                <p className="text-sm text-text-secondary-on-dark">
                  No yards yet — create your first storage yard to intake a vehicle.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={labelCls}>Yard name</span>
                  <input
                    className={inputCls}
                    value={yardName}
                    onChange={(e) => setYardName(e.target.value)}
                    placeholder="North Lot"
                  />
                </label>
                <label>
                  <span className={labelCls}>Code</span>
                  <input
                    className={inputCls}
                    value={yardCode}
                    onChange={(e) => setYardCode(e.target.value)}
                    placeholder="NORTH"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateYard}
                  disabled={yardBusy}
                  className="px-3 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
                >
                  {yardBusy ? 'Saving…' : 'Create yard'}
                </button>
                {yards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowYardForm(false)}
                    className="px-3 py-2 rounded-md border border-border-on-dark text-sm"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <legend className="px-1 text-sm font-semibold">Vehicle</legend>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label>
              <span className={labelCls}>Year</span>
              <input
                className={inputCls}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              <span className={labelCls}>Make</span>
              <input className={inputCls} value={make} onChange={(e) => setMake(e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>Model</span>
              <input
                className={inputCls}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>Color</span>
              <input
                className={inputCls}
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>License plate</span>
              <input
                className={inputCls}
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>Plate state</span>
              <input
                className={inputCls}
                value={plateState}
                onChange={(e) => setPlateState(e.target.value)}
                maxLength={32}
              />
            </label>
            <label className="col-span-2 md:col-span-3">
              <span className={labelCls}>VIN</span>
              <input
                className={inputCls}
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                maxLength={64}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <legend className="px-1 text-sm font-semibold">Storage &amp; condition</legend>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={labelCls}>Daily storage fee (USD)</span>
              <input
                className={inputCls}
                value={dailyFee}
                onChange={(e) => setDailyFee(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              <span className={labelCls}>Intake mileage</span>
              <input
                className={inputCls}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
          <label className="block mt-3">
            <span className={labelCls}>Condition notes</span>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              placeholder="Damage on arrival, contents, etc."
            />
          </label>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !yardId}
            className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
          >
            {submitting ? 'Recording…' : 'Record intake'}
          </button>
          <Link href="/impound" className="text-text-secondary-on-dark text-sm">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
