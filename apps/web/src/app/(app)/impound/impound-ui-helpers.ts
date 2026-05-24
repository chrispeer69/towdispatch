/**
 * Pure presentation helpers for the impound web views. Kept separate from
 * the client components so they can be unit-tested without a DOM.
 */
import type { ImpoundHoldType, ImpoundRecordStatus } from '@ustowdispatch/shared';

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const STATUS_LABEL: Record<ImpoundRecordStatus, string> = {
  stored: 'Stored',
  pending_release: 'Pending release',
  released: 'Released',
  transferred: 'Transferred',
  disposed: 'Disposed',
};

export const STATUS_TONE: Record<ImpoundRecordStatus, string> = {
  stored: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  pending_release: 'bg-accent-orange/25 text-accent-orange border border-accent-orange/50',
  released:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  transferred: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  disposed: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark line-through',
};

export const HOLD_LABEL: Record<ImpoundHoldType, string> = {
  police: 'Police hold',
  abandoned: 'Abandoned',
  accident: 'Accident',
  owner_request: 'Owner request',
};

export function vehicleLabel(parts: {
  vehicleYear: number | null;
  vehicleColor: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  licensePlate: string | null;
}): string {
  const desc = [parts.vehicleYear, parts.vehicleColor, parts.vehicleMake, parts.vehicleModel]
    .filter((p): p is string | number => p !== null && `${p}`.length > 0)
    .join(' ');
  if (desc) return desc;
  if (parts.licensePlate) return `Plate ${parts.licensePlate}`;
  return 'Unidentified vehicle';
}
