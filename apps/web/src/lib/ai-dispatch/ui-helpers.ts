/**
 * Presentation helpers for the AI Smart Dispatch surfaces. No i18n framework in
 * web yet (same as ev-ui-helpers): bilingual EN/ES labels are kept inline so the
 * operator console + driver app can show either. The driver-facing ETA line is
 * rendered bilingually (see etaBilingual) for parity.
 */
import type { DispatchFactorKey } from '@ustowdispatch/shared';

/** Short bilingual label for each scoring factor (UI breakdown rows). */
const FACTOR_LABELS: Record<DispatchFactorKey, { en: string; es: string }> = {
  distance: { en: 'Distance', es: 'Distancia' },
  capability: { en: 'Equipment match', es: 'Equipo compatible' },
  cert_match: { en: 'Certifications', es: 'Certificaciones' },
  fatigue: { en: 'Driver freshness', es: 'Descanso del conductor' },
  historical_performance: { en: 'Track record', es: 'Historial' },
  utilization_balance: { en: 'Workload balance', es: 'Balance de carga' },
};

export function factorLabel(key: DispatchFactorKey, lang: 'en' | 'es' = 'en'): string {
  return FACTOR_LABELS[key][lang];
}

/** "—" when null, "1h 5m" past an hour, "23 min" otherwise. */
export function formatEtaMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  return `${m} min`;
}

/** Bilingual ETA line for the driver offer card (EN / ES). */
export function etaBilingual(m: number | null | undefined): { en: string; es: string } {
  if (m === null || m === undefined) {
    return { en: 'ETA unavailable', es: 'ETA no disponible' };
  }
  return {
    en: `~${formatEtaMinutes(m)} to scene`,
    es: `~${formatEtaMinutes(m)} a la escena`,
  };
}

export type ScoreTone = 'ok' | 'warn' | 'danger';

/** ≥75 strong, ≥50 fair, else weak — drives the badge color. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 75) return 'ok';
  if (score >= 50) return 'warn';
  return 'danger';
}

export const SCORE_TONE_CLASS: Record<ScoreTone, string> = {
  ok: 'bg-ok/15 text-ok border-ok/40',
  warn: 'bg-status-warning/15 text-status-warning border-status-warning/40',
  danger: 'bg-danger/15 text-danger border-danger/40',
};
