/**
 * Pure presentation helpers for the Heavy-Duty pages. No React, no I/O —
 * unit-tested directly (hd-ui-helpers.spec.ts).
 */
import type { HdCertStatus, HdDriverCertType, HdIncidentType } from '@ustowdispatch/shared';

/** Integer cents → "$1,234.50". */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

const CERT_LABELS: Record<HdDriverCertType, string> = {
  hd_operator: 'HD Operator',
  rotator: 'Rotator',
  hazmat: 'HazMat',
  cdl_a: 'CDL-A',
  cdl_b: 'CDL-B',
};
export function certTypeLabel(t: HdDriverCertType): string {
  return CERT_LABELS[t];
}

const INCIDENT_LABELS: Record<HdIncidentType, string> = {
  overturn: 'Overturn',
  underride: 'Underride',
  jackknife: 'Jackknife',
  load_shift: 'Load shift',
  fire: 'Fire',
  water: 'Water',
  other: 'Other',
};
export function incidentLabel(t: HdIncidentType): string {
  return INCIDENT_LABELS[t];
}

/** "Class 8" / "Class 3" / "—" for null. */
export function gvwrClassLabel(cls: number | null): string {
  return cls == null ? '—' : `Class ${cls}`;
}

/** Tailwind classes for a cert-status pill. */
export function certStatusBadgeClass(status: HdCertStatus): string {
  switch (status) {
    case 'expired':
      return 'bg-status-danger/15 text-status-danger border-status-danger/40';
    case 'expiring':
      return 'bg-accent-orange/15 text-accent-orange border-accent-orange/40';
    case 'valid':
      return 'bg-status-success/15 text-status-success border-status-success/40';
    default:
      return 'bg-bg-base text-text-secondary-on-dark border-border-on-dark';
  }
}

/** A multiplier like 1.5 → "1.5×"; 1 → "—" (no premium). */
export function multiplierLabel(m: number): string {
  return m === 1 ? '—' : `${m}×`;
}

/** Pounds with thousands separators, or "—". */
export function lbsLabel(lbs: number | null): string {
  return lbs == null ? '—' : `${lbs.toLocaleString('en-US')} lb`;
}
