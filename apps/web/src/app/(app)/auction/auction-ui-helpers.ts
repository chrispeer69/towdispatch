/**
 * Presentation helpers for the staff auction UI (Session 33).
 *
 * Strings are English-only: this codebase ships no i18n infrastructure
 * (no next-intl, no messages catalog), so per Rule 9 (mirror existing) we
 * follow the impound module's label-constant pattern rather than invent a
 * parallel i18n system. The constants are shaped so a future i18n pass can
 * wrap them in a t() lookup without touching call sites. See
 * SESSION_33_DECISIONS.md.
 */
import type { AuctionConditionGrade, AuctionListingStatus } from '@ustowdispatch/shared';

export const STATUS_LABEL: Record<AuctionListingStatus, string> = {
  draft: 'Draft',
  live: 'Live',
  ended: 'Ended — review',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<AuctionListingStatus, string> = {
  draft: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  live: 'bg-accent-orange/20 text-accent-orange border border-accent-orange/40',
  ended: 'bg-status-warning/15 text-status-warning border border-status-warning/40',
  sold: 'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  withdrawn: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark line-through',
};

export const CONDITION_LABEL: Record<AuctionConditionGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  salvage: 'Salvage',
};

export function formatCents(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function vehicleLabel(l: {
  vehicleYear: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
}): string {
  const parts = [l.vehicleYear, l.make, l.model].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return l.vin ?? 'Vehicle';
}
