/**
 * Pure presentation helpers for the damage-analysis job views. Kept apart
 * from the client component so they unit-test without a DOM.
 *
 * Bilingual label maps (EN/ES) cover the enum-driven strings per the
 * Spanish-parity rule; sentence-level UI copy in the client carries
 * // TODO(i18n) until a web i18n framework lands (none exists in the repo
 * today — same posture as the impound/lien views).
 */
import type {
  DamageAnalysisStatus,
  DamageArea,
  DamageFindingDto,
  DamagePhase,
  DamageSeverity,
} from '@ustowdispatch/shared';

export type UiLang = 'en' | 'es';

export const PHASE_LABEL: Record<UiLang, Record<DamagePhase, string>> = {
  en: { pre_tow: 'Pre-tow', post_tow: 'Post-tow', claim_review: 'Claim review' },
  es: {
    pre_tow: 'Antes del remolque',
    post_tow: 'Después del remolque',
    claim_review: 'Revisión de reclamo',
  },
};

export const STATUS_LABEL: Record<UiLang, Record<DamageAnalysisStatus, string>> = {
  en: { queued: 'Queued', processing: 'Processing', complete: 'Complete', failed: 'Failed' },
  es: { queued: 'En cola', processing: 'Procesando', complete: 'Completo', failed: 'Fallido' },
};

export const SEVERITY_LABEL: Record<UiLang, Record<DamageSeverity, string>> = {
  en: { none: 'None', minor: 'Minor', moderate: 'Moderate', severe: 'Severe' },
  es: { none: 'Ninguno', minor: 'Leve', moderate: 'Moderado', severe: 'Grave' },
};

export const AREA_LABEL: Record<UiLang, Record<DamageArea, string>> = {
  en: {
    front_bumper: 'Front bumper',
    rear_bumper: 'Rear bumper',
    driver_door: 'Driver door',
    passenger_door: 'Passenger door',
    hood: 'Hood',
    roof: 'Roof',
    trunk: 'Trunk',
    wheels: 'Wheels',
    windshield: 'Windshield',
    other: 'Other',
  },
  es: {
    front_bumper: 'Parachoques delantero',
    rear_bumper: 'Parachoques trasero',
    driver_door: 'Puerta del conductor',
    passenger_door: 'Puerta del pasajero',
    hood: 'Capó',
    roof: 'Techo',
    trunk: 'Maletero',
    wheels: 'Ruedas',
    windshield: 'Parabrisas',
    other: 'Otro',
  },
};

export const SEVERITY_TONE: Record<DamageSeverity, string> = {
  none: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  minor: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  moderate: 'bg-accent-orange/20 text-accent-orange border border-accent-orange/40',
  severe:
    'bg-status-error-on-dark/20 text-status-error-on-dark border border-status-error-on-dark/40',
};

export const STATUS_TONE: Record<DamageAnalysisStatus, string> = {
  queued: 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark',
  processing: 'bg-accent-orange/15 text-accent-orange border border-accent-orange/30',
  complete:
    'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30',
  failed:
    'bg-status-error-on-dark/20 text-status-error-on-dark border border-status-error-on-dark/40',
};

/** Operator override wins over the model's severity. */
export function effectiveSeverity(
  f: Pick<DamageFindingDto, 'severity' | 'operatorSeverity'>,
): DamageSeverity {
  return f.operatorSeverity ?? f.severity;
}

/** Short filename-ish label for a storage key (last path segment). */
export function photoLabel(key: string): string {
  const seg = key.split('/').pop() ?? key;
  return seg.length > 28 ? `…${seg.slice(-26)}` : seg;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
