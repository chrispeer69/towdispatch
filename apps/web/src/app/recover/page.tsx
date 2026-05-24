'use client';
import { detectRecoverLocale, recoverMessages } from '@/lib/recover/i18n';
import { lookupVehicle } from '@/lib/recover/recover-client';
import type { PortalLookupResult } from '@ustowdispatch/shared';
import { useMemo, useState } from 'react';

export default function RecoverLookupPage(): JSX.Element {
  const t = useMemo(() => recoverMessages(detectRecoverLocale()), []);
  const [plate, setPlate] = useState('');
  const [vin, setVin] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [lastName, setLastName] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<PortalLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setStatus('searching');
    setError(null);
    try {
      const body = {
        ...(plate.trim() ? { plate: plate.trim() } : {}),
        ...(vin.trim() ? { vin: vin.trim() } : {}),
        ...(caseNumber.trim() ? { caseNumber: caseNumber.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      };
      const r = await lookupVehicle(body);
      setResult(r);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-slate-600">{t.subtitle}</p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <Field label={t.plate} value={plate} onChange={setPlate} autoCapitalize="characters" />
        <Field label={t.vin} value={vin} onChange={setVin} autoCapitalize="characters" />
        <Field label={t.caseNumber} value={caseNumber} onChange={setCaseNumber} />
        <Field label={t.lastName} value={lastName} onChange={setLastName} />
        <button
          type="submit"
          disabled={status === 'searching'}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {status === 'searching' ? t.searching : t.findVehicle}
        </button>
      </form>

      {status === 'done' && result?.found && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{t.linkSent}</p>
      )}
      {status === 'done' && result && !result.found && result.partialMatches.length > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t.multiMatch}</p>
      )}
      {status === 'done' && result && !result.found && result.partialMatches.length === 0 && (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{t.noMatch}</p>
      )}
      {status === 'error' && error && (
        <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
      )}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoCapitalize?: 'none' | 'characters';
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{props.label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        value={props.value}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}
