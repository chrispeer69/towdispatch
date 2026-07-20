'use client';
import { detectRecoverLocale, recoverMessages } from '@/lib/recover/i18n';
import { getReleaseIntent, getSession } from '@/lib/recover/recover-client';
import type { PortalReleaseIntentDto, PortalSessionView } from '@ustowdispatch/shared';
import { useEffect, useMemo, useState } from 'react';

export default function RecoverReleasePage(): JSX.Element {
  const t = useMemo(() => recoverMessages(detectRecoverLocale()), []);
  const [view, setView] = useState<PortalSessionView | null>(null);
  const [intent, setIntent] = useState<PortalReleaseIntentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [v, i] = await Promise.all([getSession(), getReleaseIntent()]);
        if (!cancelled) {
          setView(v);
          setIntent(i);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>;
  if (!view) return <p className="py-10 text-center text-slate-600">Loading…</p>;

  const ready = intent?.status === 'ready_for_gate' || intent?.status === 'gate_completed';

  return (
    <div className="space-y-5 text-center">
      <div
        className={`rounded-xl p-5 ${ready ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}
      >
        <p className="text-lg font-semibold">
          {ready ? t.readyForGate : intent ? `Status: ${intent.status}` : 'No release started yet'}
        </p>
        {ready && <p className="mt-1 text-sm">{t.showAtGate}</p>}
      </div>

      {/* Gate handoff card: case + ID-on-file flag for the operator to match. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">Case</p>
        <p className="font-mono text-sm">{view.caseNumber}</p>
        <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Vehicle</p>
        <p className="text-sm">
          {[view.vehicleYear, view.vehicleMake, view.vehicleModel].filter(Boolean).join(' ')} -{' '}
          {view.licensePlate ?? '—'}
        </p>
        <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">ID on file</p>
        <p className="text-sm">{view.idOnFile ? 'Yes — operator must verify in person' : 'No'}</p>
      </div>
    </div>
  );
}
