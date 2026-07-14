'use client';

/**
 * Shared CADS (Capacity-Aware Dispatch Signaling) UI primitives — band
 * pills, ratio/time formatters, and the "force status" override dialog.
 * Used by both the dispatch-board Capacity Signal widget and the
 * /settings/capacity page so the two surfaces cannot drift.
 *
 * Modals use the native <dialog> element (same as /settings/api) so the
 * browser supplies focus trap, Escape, and the backdrop scrim.
 */
// TODO(i18n): CADS strings are English-only today, matching the settings
// and dispatch surfaces; add es parity when those migrate to next-intl.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clientCreateCapacityOverride } from '@/lib/api/capacity-client';
import { cn } from '@/lib/utils';
import {
  CAPACITY_BANDS,
  CAPACITY_CLASS_SCOPES,
  type CapacityBand,
  type CapacityClassScope,
  type CapacityOverrideDto,
  type CreateCapacityOverridePayload,
} from '@ustowdispatch/shared';
import { X } from 'lucide-react';
import { type FormEvent, type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ---------- vocabulary ----------

export const BAND_LABEL: Record<CapacityBand, string> = {
  available_now: 'Available now',
  limited: 'Limited',
  constrained: 'Constrained',
  at_capacity: 'At capacity',
  offline: 'Offline',
};

/**
 * Band → pill tone. Draws only from the LOCKED brand palette in
 * tailwind.config.ts: green=ok, yellow=warn, orange=accent-orange,
 * red=danger, gray=neutral surface.
 */
export const BAND_TONE: Record<CapacityBand, string> = {
  available_now: 'bg-ok/15 text-ok border-ok/40',
  limited: 'bg-warn/15 text-warn border-warn/40',
  constrained: 'bg-accent-orange/15 text-accent-orange border-accent-orange/40',
  at_capacity: 'bg-danger/15 text-danger border-danger/40',
  offline: 'bg-bg-surface-elevated text-text-secondary-on-dark border-divider',
};

export const CLASS_LABEL: Record<CapacityClassScope, string> = {
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
  all: 'All classes',
};

export { CAPACITY_BANDS, CAPACITY_CLASS_SCOPES };

// ---------- formatters ----------

/** "0.67" for a live ratio; "—" while a class is offline (null ratio). */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  return ratio.toFixed(2);
}

/** Compact relative "3m ago" / "2h ago" for lastBroadcastAt-style stamps. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "2h 05m left" until an override's expiresAt; "expired" once past. */
export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m left`;
}

// ---------- pills ----------

export function BandPill({
  band,
  size = 'sm',
}: {
  band: CapacityBand;
  size?: 'sm' | 'lg';
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-condensed font-extrabold uppercase',
        size === 'lg'
          ? 'px-3 py-1 text-xs tracking-widest'
          : 'px-2 py-0.5 text-[10px] tracking-widest',
        BAND_TONE[band],
      )}
    >
      {BAND_LABEL[band]}
    </span>
  );
}

// ---------- modal plumbing (native <dialog>, as in /settings/api) ----------

export function useCapacityDialog(): React.MutableRefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return ref;
}

export function CapacityModal({
  titleId,
  title,
  onClose,
  children,
  wide,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): JSX.Element {
  const dialogRef = useCapacityDialog();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'w-full rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary-on-dark">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

// ---------- "force status" override dialog ----------

/** 1h / 4h / 8h / 24h duration presets, in minutes. */
const OVERRIDE_DURATIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 1440, label: '24 hours' },
] as const;

export const capacitySelectCls =
  'h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus-visible:outline-none focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary/40';

export function SetOverrideDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (override: CapacityOverrideDto) => void;
}): JSX.Element {
  const [dutyClass, setDutyClass] = useState<CapacityClassScope>('all');
  const [forcedBand, setForcedBand] = useState<CapacityBand>('at_capacity');
  const [reason, setReason] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState<number>(240);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    if (reason.trim().length < 3) {
      setErrorMessage('A reason (at least 3 characters) is required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateCapacityOverridePayload = {
        dutyClass,
        forcedBand,
        reason: reason.trim(),
        expiresInMinutes,
      };
      const created = await clientCreateCapacityOverride(payload);
      onCreated(created);
      toast.success(
        `Capacity forced to "${BAND_LABEL[forcedBand]}" for ${CLASS_LABEL[dutyClass].toLowerCase()}.`,
      );
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CapacityModal titleId="set-override-title" title="Force capacity status" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-xs text-text-secondary-on-dark">
          Overrides win over the computed signal until they expire or are cleared. The math keeps
          running underneath and resumes automatically.
        </p>
        <div className="space-y-1">
          <Label htmlFor="override-class">Duty class</Label>
          <select
            id="override-class"
            value={dutyClass}
            onChange={(e) => setDutyClass(e.target.value as CapacityClassScope)}
            className={capacitySelectCls}
          >
            {CAPACITY_CLASS_SCOPES.map((c) => (
              <option key={c} value={c}>
                {CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="override-band">Forced status</Label>
          <select
            id="override-band"
            value={forcedBand}
            onChange={(e) => setForcedBand(e.target.value as CapacityBand)}
            className={capacitySelectCls}
          >
            {CAPACITY_BANDS.map((b) => (
              <option key={b} value={b}>
                {BAND_LABEL[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="override-reason">Reason</Label>
          <Input
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. Storm surge — all trucks committed"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="override-duration">Duration</Label>
          <select
            id="override-duration"
            value={expiresInMinutes}
            onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
            className={capacitySelectCls}
          >
            {OVERRIDE_DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {errorMessage}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
          >
            Cancel
          </button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Force status'}
          </Button>
        </div>
      </form>
    </CapacityModal>
  );
}
