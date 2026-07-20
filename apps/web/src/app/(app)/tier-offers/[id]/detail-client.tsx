'use client';
/**
 * Detail / sent-tracker client.
 *
 * Polls /tier-offers/:id every 30 seconds while the offer is in
 * `sent` or `event_active` so accept / decline events from recipients
 * surface promptly. Runs no polling when the offer is `draft` or
 * `event_concluded` / `cancelled` (those are settled and quiet).
 *
 * Inline actions:
 *   - Cancel (sent / event_active only, owner/admin/manager) — opens
 *     a small confirmation dialog with optional reason.
 *   - Copy magic link (owner/admin only) — copies the ?token=... URL
 *     for that recipient to the clipboard so the operator can resend
 *     manually if a SendGrid bounce happens before Session 4 lands.
 *   - Download reconciliation CSV — opens a blob download from the BFF.
 */
import { useUser } from '@/components/app-shell/session-provider';
import {
  type ReconciliationReport,
  clientCancelTierOffer,
  clientGetReconciliation,
  clientGetTierOffer,
} from '@/lib/api/tier-offers-client';
import type {
  TierOfferDto,
  TierOfferRecipientDto,
  TierOfferRecipientStatus,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type JSX, useEffect, useState } from 'react';

interface Props {
  initialOffer: TierOfferDto;
  initialRecipients: TierOfferRecipientDto[];
  initialReconciliation: ReconciliationReport | null;
}

const RECIPIENT_TONE: Record<TierOfferRecipientStatus, string> = {
  pending_send: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  sent: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  delivered: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  opened: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  accepted:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  declined: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  expired:
    'bg-status-danger-on-dark/15 text-status-danger-on-dark border border-status-danger-on-dark/30',
  revoked:
    'bg-status-danger-on-dark/15 text-status-danger-on-dark border border-status-danger-on-dark/30',
  bounced:
    'bg-status-danger-on-dark/15 text-status-danger-on-dark border border-status-danger-on-dark/30',
};

const COMPOSER_ROLES = new Set(['owner', 'admin', 'manager']);
const COPY_LINK_ROLES = new Set(['owner', 'admin']);

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildMagicLink(token: string): string {
  if (typeof window === 'undefined') return `/offers/${token}`;
  return `${window.location.origin}/offers/${token}`;
}

export function OfferDetailClient({
  initialOffer,
  initialRecipients,
  initialReconciliation,
}: Props): JSX.Element {
  const user = useUser();
  const [offer, setOffer] = useState<TierOfferDto>(initialOffer);
  const [recipients, setRecipients] = useState<TierOfferRecipientDto[]>(initialRecipients);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(
    initialReconciliation,
  );
  const [cancelOpen, setCancelOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelBusy, setCancelBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingCsv, setDownloadingCsv] = useState<boolean>(false);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  const canCancel =
    COMPOSER_ROLES.has(user.role) && (offer.status === 'sent' || offer.status === 'event_active');
  const canCopyLink = COPY_LINK_ROLES.has(user.role);
  const polling = offer.status === 'sent' || offer.status === 'event_active';

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      try {
        const next = await clientGetTierOffer(offer.id);
        setOffer(next.offer);
        setRecipients(next.recipients);
        if (next.offer.status === 'event_concluded') {
          const r = await clientGetReconciliation(offer.id);
          setReconciliation(r);
        }
      } catch {
        // Silent — polling will retry on the next tick.
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [polling, offer.id]);

  async function doCancel(): Promise<void> {
    setCancelBusy(true);
    try {
      const updated = await clientCancelTierOffer(offer.id, {
        reason: cancelReason.trim() || undefined,
      });
      setOffer(updated);
      // Reload recipients (revoked side effect)
      const fresh = await clientGetTierOffer(offer.id);
      setRecipients(fresh.recipients);
      setCancelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel offer.');
    } finally {
      setCancelBusy(false);
    }
  }

  async function downloadCsv(): Promise<void> {
    setDownloadingCsv(true);
    try {
      const res = await fetch(`/api/tier-offers/${offer.id}/reconciliation.csv`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tier-offer-${offer.id}-reconciliation.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download CSV.');
    } finally {
      setDownloadingCsv(false);
    }
  }

  async function copyLink(token: string, recipientId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildMagicLink(token));
      setCopiedFor(recipientId);
      setTimeout(() => setCopiedFor(null), 2000);
    } catch {
      setError('Clipboard write failed; copy the link manually from the URL bar.');
    }
  }

  return (
    <section>
      <header className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark mb-1">
            Tier offer
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{offer.title}</h1>
          <p className="text-sm text-text-secondary-on-dark mt-1 max-w-2xl">{offer.subjectLine}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-block px-3 py-1 rounded text-xs font-semibold uppercase ${
              offer.status === 'event_concluded'
                ? 'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30'
                : offer.status === 'cancelled'
                  ? 'bg-status-danger-on-dark/15 text-status-danger-on-dark border border-status-danger-on-dark/30'
                  : 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30'
            }`}
          >
            {offer.status.replace('_', ' ')}
          </span>
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm"
            >
              Cancel offer
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-status-danger-on-dark/40 bg-status-danger-on-dark/10 text-sm">
          {error}
        </div>
      )}

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 text-sm">
        <Stat label="Trucks committed">{offer.committedTruckCount}</Stat>
        <Stat label="Window">
          <span className="block text-xs">
            {fmt(offer.eventWindowStart)} → {fmt(offer.eventWindowEnd)}
          </span>
        </Stat>
        <Stat label="Acceptance deadline">{fmt(offer.acceptanceDeadlineAt)}</Stat>
        <Stat label="Default if no reply">
          {offer.defaultForNonResponders === 'opt_out' ? 'Opt out' : 'Standard rate'}
        </Stat>
      </dl>

      <h2 className="text-xl font-bold tracking-tight mb-3">Recipient roster</h2>
      <div className="bg-bg-surface-elevated border border-border-on-dark rounded-md overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Recipient</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Responded</th>
              <th className="text-left px-4 py-2.5">Response IP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary-on-dark">
                  No recipients on this offer.
                </td>
              </tr>
            )}
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-border-on-dark">
                <td className="px-4 py-2.5">
                  <div className="font-semibold">{r.recipientName}</div>
                  <div className="text-xs text-text-secondary-on-dark">
                    {r.recipientRole ? `${r.recipientRole} - ` : ''}
                    {r.recipientEmail}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${RECIPIENT_TONE[r.status]}`}
                  >
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                  {r.respondedAt ? fmt(r.respondedAt) : '—'}
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-text-secondary-on-dark">
                  {r.responseIp ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canCopyLink && r.status !== 'revoked' && r.status !== 'expired' && (
                    <button
                      type="button"
                      onClick={() => copyLink(r.magicLinkToken, r.id)}
                      className="text-xs text-accent-orange"
                    >
                      {copiedFor === r.id ? 'Copied' : 'Copy magic link'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reconciliation && (
        <Reconciliation
          report={reconciliation}
          onDownloadCsv={downloadCsv}
          downloading={downloadingCsv}
        />
      )}

      {cancelOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50">
          <div className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-6 max-w-md w-full space-y-4">
            <h2 className="text-xl font-bold">Cancel this offer?</h2>
            <p className="text-sm text-text-secondary-on-dark">
              Recipients still in flight (pending / sent / delivered / opened) will be marked as
              revoked. Recipients who already accepted or declined keep their response — that row is
              the contractual record and we never regress it.
            </p>
            <label
              htmlFor="cancel-reason"
              className="block text-xs font-semibold uppercase tracking-wide text-text-secondary-on-dark"
            >
              Reason (optional)
            </label>
            <textarea
              id="cancel-reason"
              rows={3}
              maxLength={2000}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full bg-bg-base border border-border-on-dark rounded-md p-2 text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="px-4 py-2 rounded-md border border-border-on-dark text-sm"
              >
                Keep offer
              </button>
              <button
                type="button"
                onClick={doCancel}
                disabled={cancelBusy}
                className="px-4 py-2 rounded-md bg-status-danger-on-dark text-white text-sm disabled:opacity-50"
              >
                {cancelBusy ? 'Cancelling…' : 'Cancel offer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8">
        <Link href="/tier-offers" className="text-accent-orange text-sm">
          ← Back to all offers
        </Link>
      </p>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-bg-surface-elevated border border-border-on-dark rounded-md p-3">
      <dt className="text-[10px] uppercase tracking-wide text-text-secondary-on-dark">{label}</dt>
      <dd className="mt-1 text-base font-semibold">{children}</dd>
    </div>
  );
}

function Reconciliation({
  report,
  onDownloadCsv,
  downloading,
}: {
  report: ReconciliationReport;
  onDownloadCsv: () => Promise<void> | void;
  downloading: boolean;
}): JSX.Element {
  return (
    <section>
      <header className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Reconciliation</h2>
          {report.disclaimer && (
            <p className="text-sm text-text-secondary-on-dark mt-1">{report.disclaimer}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDownloadCsv}
          disabled={downloading}
          className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
        >
          {downloading ? 'Preparing CSV…' : 'Download CSV'}
        </button>
      </header>
      <div className="bg-bg-surface-elevated border border-border-on-dark rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Recipient</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Jobs</th>
              <th className="text-right px-4 py-2.5">Billed</th>
              <th className="text-right px-4 py-2.5">Std baseline</th>
              <th className="text-right px-4 py-2.5">Uplift</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary-on-dark">
                  No reconciliation rows yet.
                </td>
              </tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.recipientId} className="border-t border-border-on-dark">
                <td className="px-4 py-2.5">
                  <div className="font-semibold">{r.recipientName}</div>
                  <div className="text-xs text-text-secondary-on-dark">
                    {r.accountName ?? r.recipientEmail}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs uppercase">{r.status.replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-right">{r.jobsCompleted}</td>
                <td className="px-4 py-2.5 text-right">${(r.totalBilledCents / 100).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right">
                  ${(r.estimatedStandardCents / 100).toFixed(2)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-semibold ${
                    r.upliftCents > 0
                      ? 'text-status-success-on-dark'
                      : 'text-text-secondary-on-dark'
                  }`}
                >
                  ${(r.upliftCents / 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
