/**
 * Pure presentation helpers for the fraud-detection web views. Kept separate
 * from the client components so they can be unit-tested without a DOM.
 */
import type {
  DisputeStatus,
  FraudRiskBand,
  FraudSeverity,
  FraudSignalType,
} from '@ustowdispatch/shared';

export function formatCents(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

export const BAND_LABEL: Record<FraudRiskBand, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** Tone classes for a risk band chip — escalating urgency. */
export const BAND_TONE: Record<FraudRiskBand, string> = {
  low: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  medium: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  high: 'bg-status-warning/15 text-status-warning border border-status-warning/30',
  critical: 'bg-status-warning/25 text-status-warning border border-status-warning/50 font-bold',
};

export const SEVERITY_TONE: Record<FraudSeverity, string> = {
  info: 'text-text-secondary-on-dark',
  low: 'text-text-secondary-on-dark',
  medium: 'text-accent-orange',
  high: 'text-status-warning font-semibold',
};

export const SIGNAL_LABEL: Record<FraudSignalType, string> = {
  duplicate_invoice: 'Duplicate invoice',
  excessive_mileage: 'Excessive mileage',
  rapid_resequencing: 'Rapid resequencing',
  off_hours_dispatch: 'Off-hours dispatch',
  missing_evidence: 'Missing evidence',
  driver_anomaly: 'Driver volume anomaly',
  cash_only_pattern: 'Cash-only pattern',
  geofence_violation: 'Geofence violation',
  bill_to_storage_acceleration: 'Storage acceleration',
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  withdrawn: 'Withdrawn',
  partial: 'Partial',
};

export const DISPUTE_STATUS_TONE: Record<DisputeStatus, string> = {
  open: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  won: 'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  lost: 'bg-status-warning/15 text-status-warning border border-status-warning/30',
  withdrawn: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  partial: 'bg-accent-orange/10 text-accent-orange border border-accent-orange/20',
};

/** Tone classes for a numeric 0-100 score. */
export function scoreTone(score: number): string {
  if (score >= 80) return 'text-status-warning font-bold';
  if (score >= 60) return 'text-status-warning';
  if (score >= 30) return 'text-accent-orange';
  return 'text-text-secondary-on-dark';
}

export function formatWinRate(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`;
}
