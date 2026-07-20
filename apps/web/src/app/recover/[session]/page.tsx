'use client';
import { detectRecoverLocale, recoverMessages } from '@/lib/recover/i18n';
import { getBalance, getSession } from '@/lib/recover/recover-client';
import type { PortalBalance, PortalSessionView } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RecoverDetailPage(): JSX.Element {
  const t = useMemo(() => recoverMessages(detectRecoverLocale()), []);
  const params = useParams<{ session: string }>();
  const sessionId = params.session;
  const [view, setView] = useState<PortalSessionView | null>(null);
  const [balance, setBalance] = useState<PortalBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [v, b] = await Promise.all([getSession(), getBalance()]);
        if (!cancelled) {
          setView(v);
          setBalance(b);
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
  if (!view || !balance) return <p className="py-10 text-center text-slate-600">Loading…</p>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">
          {[view.vehicleYear, view.vehicleMake, view.vehicleModel].filter(Boolean).join(' ') ||
            'Your vehicle'}
        </h1>
        <p className="text-sm text-slate-600">
          {view.licensePlate ?? '—'} - {view.yardName ?? 'Impound yard'} - {view.status}
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-600">{t.balanceDue}</span>
          <span className="text-2xl font-semibold">{usd(balance.balanceCents)}</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {balance.lines.map((l) => (
            <li key={l.feeType} className="flex justify-between">
              <span>{l.label}</span>
              <span>{usd(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      {!view.idOnFile && (
        <Link
          href={`/recover/${sessionId}/id`}
          className="block rounded-lg border border-slate-300 px-4 py-3 text-center font-medium"
        >
          {t.provideId}
        </Link>
      )}
      {balance.balanceCents > 0 ? (
        <Link
          href={`/recover/${sessionId}/pay`}
          className="block rounded-lg bg-slate-900 px-4 py-3 text-center font-medium text-white"
        >
          {t.payNow} - {usd(balance.balanceCents)}
        </Link>
      ) : (
        <Link
          href={`/recover/${sessionId}/release`}
          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-medium text-white"
        >
          {t.readyForGate}
        </Link>
      )}
    </div>
  );
}
