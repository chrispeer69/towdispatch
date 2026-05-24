'use client';
import { clientCreateRepoCase } from '@/lib/api/repo-client';
import type { CreateRepoCasePayload, LienholderDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

export function NewRepoCaseClient({ lienholders }: { lienholders: LienholderDto[] }): JSX.Element {
  const router = useRouter();
  const [lienholderId, setLienholderId] = useState<string>(lienholders[0]?.id ?? '');
  const [caseNumber, setCaseNumber] = useState('');
  const [vin, setVin] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [plate, setPlate] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [debtorAddress, setDebtorAddress] = useState('');
  const [debtorPhone, setDebtorPhone] = useState('');
  const [redemptionWindowDays, setRedemptionWindowDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = lienholderId.length > 0 && caseNumber.trim().length > 0;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: CreateRepoCasePayload = {
        lienholderId,
        caseNumber: caseNumber.trim(),
        ...(vin ? { vin } : {}),
        ...(vehicleYear ? { vehicleYear: Number(vehicleYear) } : {}),
        ...(vehicleMake ? { vehicleMake } : {}),
        ...(vehicleModel ? { vehicleModel } : {}),
        ...(vehicleColor ? { vehicleColor } : {}),
        ...(plate ? { plate } : {}),
        ...(debtorName ? { debtorName } : {}),
        ...(debtorAddress ? { debtorAddress } : {}),
        ...(debtorPhone ? { debtorPhone } : {}),
        ...(redemptionWindowDays ? { redemptionWindowDays: Number(redemptionWindowDays) } : {}),
        ...(notes ? { notes } : {}),
      };
      const detail = await clientCreateRepoCase(body);
      router.push(`/repo/cases/${detail.case.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the repo case');
      setBusy(false);
    }
  }

  return (
    <section className="max-w-2xl">
      <Link href="/repo/cases" className="text-accent-orange text-sm">
        ← Repo cases
      </Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1 mb-1">New repo case</h1>
      <p className="text-text-secondary-on-dark text-sm mb-6">
        Open a repossession assignment against a lienholder.
      </p>

      {lienholders.length === 0 && (
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-6 text-sm text-text-secondary-on-dark">
          No active lienholders yet. Add one on the{' '}
          <Link href="/repo/lienholders" className="text-accent-orange">
            Lienholders
          </Link>{' '}
          page first.
        </div>
      )}

      {lienholders.length > 0 && (
        <form
          className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          {error && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
              {error}
            </div>
          )}

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Lienholder</span>
            <select
              value={lienholderId}
              onChange={(e) => setLienholderId(e.target.value)}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            >
              {lienholders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Case number</span>
            <input
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              required
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">VIN (optional)</span>
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Plate (optional)</span>
              <input
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Year</span>
              <input
                type="number"
                min="1900"
                max="2200"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Make</span>
              <input
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Model</span>
              <input
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Color</span>
              <input
                value={vehicleColor}
                onChange={(e) => setVehicleColor(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Debtor name (optional)</span>
            <input
              value={debtorName}
              onChange={(e) => setDebtorName(e.target.value)}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">
                Debtor address (optional)
              </span>
              <input
                value={debtorAddress}
                onChange={(e) => setDebtorAddress(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">
                Debtor phone (optional)
              </span>
              <input
                value={debtorPhone}
                onChange={(e) => setDebtorPhone(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">
              Redemption window (days, optional)
            </span>
            <input
              type="number"
              min="0"
              max="3650"
              value={redemptionWindowDays}
              onChange={(e) => setRedemptionWindowDays(e.target.value)}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            />
          </label>

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open repo case'}
          </button>
        </form>
      )}
    </section>
  );
}
