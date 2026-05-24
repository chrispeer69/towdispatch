'use client';
import { clientOpenCase } from '@/lib/api/lien-client';
import type { ImpoundRecordDto, LienState, LienValueTier } from '@ustowdispatch/shared';
import { lienStateValues, lienValueTierValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

function describe(r: ImpoundRecordDto): string {
  const d = [r.vehicleYear, r.vehicleColor, r.vehicleMake, r.vehicleModel]
    .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
    .join(' ');
  const plate = r.licensePlate ? ` · ${r.licensePlate}` : '';
  return `${d || 'Unidentified vehicle'}${plate}`;
}

export function OpenLienCaseClient({
  records,
  preselectRecordId,
}: {
  records: ImpoundRecordDto[];
  preselectRecordId: string | null;
}): JSX.Element {
  const router = useRouter();
  const [recordId, setRecordId] = useState<string>(
    preselectRecordId && records.some((r) => r.id === preselectRecordId)
      ? preselectRecordId
      : (records[0]?.id ?? ''),
  );
  const [state, setState] = useState<LienState>(
    (records.find((r) => r.id === recordId)?.licenseState as LienState) ?? 'CA',
  );
  const [valueTier, setValueTier] = useState<LienValueTier | ''>('');
  const [estimated, setEstimated] = useState('');
  const [ownerFound, setOwnerFound] = useState(false);
  const [lienholderFound, setLienholderFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validState = lienStateValues.includes(state);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const detail = await clientOpenCase({
        impoundRecordId: recordId,
        state,
        ...(valueTier ? { vehicleValueTier: valueTier } : {}),
        ...(estimated ? { estimatedValueCents: Math.round(Number(estimated) * 100) } : {}),
        ownerFound,
        lienholderFound,
      });
      router.push(`/lien-cases/${detail.case.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the lien case');
      setBusy(false);
    }
  }

  return (
    <section className="max-w-2xl">
      <Link href="/lien-cases" className="text-accent-orange text-sm">
        ← Lien cases
      </Link>
      <h1 className="text-2xl font-bold tracking-tight mt-1 mb-1">Open lien case</h1>
      <p className="text-text-secondary-on-dark text-sm mb-6">
        Start a statutory lien-sale proceeding against a lien-eligible impounded vehicle.
      </p>

      {records.length === 0 && (
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-6 text-sm text-text-secondary-on-dark">
          No lien-eligible impound records yet. A vehicle becomes lien-eligible after the statutory
          storage period; check the Impound &amp; Storage list.
        </div>
      )}

      {records.length > 0 && (
        <form
          className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validState && recordId) void submit();
          }}
        >
          {error && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
              {error}
            </div>
          )}

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">Impound record</span>
            <select
              value={recordId}
              onChange={(e) => {
                setRecordId(e.target.value);
                const r = records.find((x) => x.id === e.target.value);
                if (r?.licenseState && lienStateValues.includes(r.licenseState as LienState)) {
                  setState(r.licenseState as LienState);
                }
              }}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {describe(r)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="block text-text-secondary-on-dark mb-1">State</span>
            <select
              value={state}
              onChange={(e) => setState(e.target.value as LienState)}
              className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
            >
              {lienStateValues.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">Value tier (optional)</span>
              <select
                value={valueTier}
                onChange={(e) => setValueTier(e.target.value as LienValueTier | '')}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              >
                <option value="">Auto (from value)</option>
                {lienValueTierValues.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-text-secondary-on-dark mb-1">
                Estimated value (USD, optional)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={estimated}
                onChange={(e) => setEstimated(e.target.value)}
                className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={ownerFound}
                onChange={(e) => setOwnerFound(e.target.checked)}
              />
              Registered owner found
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={lienholderFound}
                onChange={(e) => setLienholderFound(e.target.checked)}
              />
              Lienholder found
            </label>
          </div>

          <button
            type="submit"
            disabled={busy || !recordId || !validState}
            className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open lien case'}
          </button>
        </form>
      )}
    </section>
  );
}
