'use client';
import { useUser } from '@/components/app-shell/session-provider';
import type { TierOfferDto, TierOfferStatus } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useTransition } from 'react';

interface Props {
  offers: TierOfferDto[];
  status: TierOfferStatus | null;
}

const FILTERS: { label: string; status: TierOfferStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Draft', status: 'draft' },
  { label: 'Sent', status: 'sent' },
  { label: 'Event active', status: 'event_active' },
  { label: 'Concluded', status: 'event_concluded' },
  { label: 'Cancelled', status: 'cancelled' },
];

const STATUS_TONE: Record<TierOfferStatus, string> = {
  draft: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  sent: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  event_active: 'bg-accent-orange/25 text-accent-orange border border-accent-orange/50',
  event_concluded:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  cancelled: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark line-through',
};

const COMPOSER_ROLES = new Set(['owner', 'admin', 'manager']);

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TierOfferListClient({ offers, status }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const user = useUser();
  const canCompose = COMPOSER_ROLES.has(user.role);

  function go(s: TierOfferStatus | null): void {
    startTransition(() => {
      router.push(s ? `/tier-offers?status=${s}` : '/tier-offers');
    });
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tier Offers</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Compose pricing offers, track motor-club acceptance, and reconcile uplift after the
            event window.
          </p>
        </div>
        {canCompose && (
          <Link
            href="/tier-offers/new"
            className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold"
          >
            Compose new offer
          </Link>
        )}
      </header>

      <nav className="flex flex-wrap gap-2 mb-4" aria-label="Filter offers by status">
        {FILTERS.map((f) => {
          const active = (status ?? null) === f.status;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => go(f.status)}
              disabled={pending}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                active
                  ? 'bg-accent-orange text-white border-accent-orange'
                  : 'border-border-on-dark text-text-secondary-on-dark hover:text-text-primary-on-dark'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </nav>

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Offer</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Window</th>
              <th className="text-left px-4 py-2.5">Trucks</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No offers in this view yet.
                </td>
              </tr>
            )}
            {offers.map((o) => (
              <tr key={o.id} className="border-t border-border-on-dark hover:bg-bg-base/30">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/tier-offers/${o.id}`}
                    className="font-semibold hover:text-accent-orange"
                  >
                    {o.title}
                  </Link>
                  <div className="text-[11px] text-text-secondary-on-dark truncate max-w-md">
                    {o.subjectLine}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[o.status]}`}
                  >
                    {o.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {fmtDate(o.eventWindowStart)} → {fmtDate(o.eventWindowEnd)}
                </td>
                <td className="px-4 py-2.5">{o.committedTruckCount}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {fmtDate(o.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/tier-offers/${o.id}`} className="text-accent-orange text-xs">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
