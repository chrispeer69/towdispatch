/**
 * Pure backup-freshness assessment (Phase 0 hardening, Session 17).
 *
 * The platform (Railway managed Postgres) takes automated daily backups.
 * This module answers one question deterministically: given the timestamp
 * of the most recent backup and a max-age threshold, is the backup fresh
 * enough? No I/O — the fetch of `lastBackupAt` lives behind a
 * `BackupMetadataSource` in the cron / CLI so this decision is unit-tested
 * directly and the data source can be stubbed.
 *
 * `lastBackupAt === null` means "no backup metadata is available" (e.g. the
 * Railway API token isn't configured, or the API returned nothing). That is
 * treated as NOT OK — an unverifiable backup is a failed verification, not a
 * silent pass.
 */

export interface BackupFreshness {
  /** True only when a backup exists and is younger than maxAgeHours. */
  ok: boolean;
  /** Age of the most recent backup in hours, or null when unknown. */
  ageHours: number | null;
  /** Human-readable reason — safe to log and to send to Sentry as an alert. */
  reason: string;
}

/** Source of the most-recent-backup timestamp. Stubbable; may be async. */
export interface BackupMetadataSource {
  /** Returns the most recent backup time, or null if it can't be determined. */
  getLastBackupAt(): Promise<Date | null>;
  /** Short label for logs (e.g. 'railway-api', 'unconfigured-stub'). */
  readonly id: string;
}

export function assessBackupFreshness(
  lastBackupAt: Date | null,
  now: Date,
  maxAgeHours: number,
): BackupFreshness {
  if (lastBackupAt === null) {
    return {
      ok: false,
      ageHours: null,
      reason: 'No backup metadata available (backup source unconfigured or returned nothing).',
    };
  }

  const ageMs = now.getTime() - lastBackupAt.getTime();
  const ageHours = Math.round((ageMs / 3_600_000) * 100) / 100;

  if (ageMs < 0) {
    // A future timestamp means clock skew or a bad parse — refuse to pass.
    return {
      ok: false,
      ageHours,
      reason: `Most recent backup timestamp is in the future (${lastBackupAt.toISOString()}); clock skew or bad data.`,
    };
  }

  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      ageHours,
      reason: `Most recent backup is ${ageHours}h old, exceeding the ${maxAgeHours}h threshold.`,
    };
  }

  return {
    ok: true,
    ageHours,
    reason: `Most recent backup is ${ageHours}h old (within the ${maxAgeHours}h threshold).`,
  };
}
