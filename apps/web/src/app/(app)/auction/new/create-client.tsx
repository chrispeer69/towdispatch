'use client';
import { clientCreateListing } from '@/lib/api/auction-client';
import type {
  AuctionConditionGrade,
  AuctionEligibleVehicleDto,
  CreateAuctionListingPayload,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';
import { CONDITION_LABEL, vehicleLabel } from '../auction-ui-helpers';

interface Props {
  eligible: AuctionEligibleVehicleDto[];
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const GRADES: AuctionConditionGrade[] = ['excellent', 'good', 'fair', 'poor', 'salvage'];

function dollarsToCents(v: string): number {
  const n = Number.parseFloat(v || '0');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function AuctionCreateClient({ eligible }: Props): JSX.Element {
  const router = useRouter();
  const [impoundRecordId, setImpoundRecordId] = useState('');
  const [vin, setVin] = useState('');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [mileage, setMileage] = useState('');
  const [condition, setCondition] = useState<AuctionConditionGrade | ''>('');
  const [startingBid, setStartingBid] = useState('500.00');
  const [reserve, setReserve] = useState('');
  const [photoKeys, setPhotoKeys] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickEligible(id: string): void {
    setImpoundRecordId(id);
    const v = eligible.find((e) => e.impoundRecordId === id);
    if (v) {
      setVin(v.vin ?? '');
      setYear(v.vehicleYear ? String(v.vehicleYear) : '');
      setMake(v.make ?? '');
      setModel(v.model ?? '');
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const startingBidCents = dollarsToCents(startingBid);
    if (startingBidCents < 0) {
      setError('Starting bid must be a non-negative amount.');
      return;
    }
    const reserveCents = reserve.trim() ? dollarsToCents(reserve) : undefined;
    if (reserveCents !== undefined && reserveCents < startingBidCents) {
      setError('Reserve must be at least the starting bid.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateAuctionListingPayload = {
        startingBidCents,
        photoKeys: photoKeys
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        ...(impoundRecordId ? { impoundRecordId } : {}),
        ...(vin.trim() ? { vin: vin.trim() } : {}),
        ...(year.trim() ? { vehicleYear: Number.parseInt(year, 10) } : {}),
        ...(make.trim() ? { make: make.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(mileage.trim() ? { mileage: Number.parseInt(mileage, 10) } : {}),
        ...(condition ? { conditionGrade: condition } : {}),
        ...(reserveCents !== undefined ? { reservePriceCents: reserveCents } : {}),
      };
      const created = await clientCreateListing(payload);
      router.push(`/auction/${created.id}`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to create listing.');
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">New auction listing</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          Create a draft. Publish it from the listing page to open bidding.
        </p>
        <p className="mt-2">
          <Link href="/auction" className="text-accent-orange text-sm">
            ← Back to auctions
          </Link>
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
        <div>
          <label className={labelCls} htmlFor="eligible">
            Lien-cleared vehicle (optional)
          </label>
          <select
            id="eligible"
            className={inputCls}
            value={impoundRecordId}
            onChange={(e) => pickEligible(e.target.value)}
          >
            <option value="">Manual entry (no impound link)</option>
            {eligible.map((v) => (
              <option key={v.impoundRecordId} value={v.impoundRecordId}>
                {vehicleLabel({
                  vehicleYear: v.vehicleYear,
                  make: v.make,
                  model: v.model,
                  vin: v.vin,
                })}
                {v.licensePlate ? ` - ${v.licensePlate}` : ''}
              </option>
            ))}
          </select>
          {eligible.length === 0 && (
            <p className="mt-1 text-xs text-text-secondary-on-dark">
              No lien-cleared vehicles available — enter details manually.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="vin">
              VIN
            </label>
            <input
              id="vin"
              className={inputCls}
              value={vin}
              onChange={(e) => setVin(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="year">
              Year
            </label>
            <input
              id="year"
              className={inputCls}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="make">
              Make
            </label>
            <input
              id="make"
              className={inputCls}
              value={make}
              onChange={(e) => setMake(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="model">
              Model
            </label>
            <input
              id="model"
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="mileage">
              Mileage
            </label>
            <input
              id="mileage"
              className={inputCls}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="condition">
              Condition
            </label>
            <select
              id="condition"
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value as AuctionConditionGrade | '')}
            >
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {CONDITION_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="starting">
              Starting bid (USD)
            </label>
            <input
              id="starting"
              className={inputCls}
              value={startingBid}
              onChange={(e) => setStartingBid(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="reserve">
              Reserve (USD, optional)
            </label>
            <input
              id="reserve"
              className={inputCls}
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="photos">
            Photo keys (one per line, optional)
          </label>
          <textarea
            id="photos"
            className={`${inputCls} min-h-20`}
            value={photoKeys}
            onChange={(e) => setPhotoKeys(e.target.value)}
            placeholder="s3-object-key-1&#10;s3-object-key-2"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create draft'}
        </button>
      </form>
    </section>
  );
}
