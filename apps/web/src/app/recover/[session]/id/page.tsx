'use client';
import { detectRecoverLocale, recoverMessages } from '@/lib/recover/i18n';
import { attestId } from '@/lib/recover/recover-client';
import type { PortalIdType } from '@ustowdispatch/shared';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const ID_TYPES: { value: PortalIdType; label: string }[] = [
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'state_id', label: 'State ID' },
  { value: 'passport', label: 'Passport' },
];

export default function RecoverIdPage(): JSX.Element {
  const t = useMemo(() => recoverMessages(detectRecoverLocale()), []);
  const router = useRouter();
  const params = useParams<{ session: string }>();
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [idType, setIdType] = useState<PortalIdType>('drivers_license');
  const [idLast4, setIdLast4] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await attestId({ fullName: fullName.trim(), dob, idType, idLast4: idLast4.trim() });
      router.replace(`/recover/${params.session}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-semibold">{t.provideId}</h1>
      <p className="text-sm text-slate-600">
        We store only the last 4 of your ID, encrypted. The gate operator verifies your physical ID
        at pickup.
      </p>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">{t.fullName}</span>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">{t.dob}</span>
        <input
          type="date"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">{t.idType}</span>
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          value={idType}
          onChange={(e) => setIdType(e.target.value as PortalIdType)}
        >
          {ID_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">{t.idLast4}</span>
        <input
          inputMode="numeric"
          maxLength={4}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          value={idLast4}
          onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, ''))}
          required
        />
      </label>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {t.submit}
      </button>
    </form>
  );
}
