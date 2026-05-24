#!/usr/bin/env tsx
/**
 * scripts/ops/verify-db-backup.ts — Phase 0 hardening (Session 17).
 *
 * Asserts that the most recent automated DB backup is younger than the
 * freshness threshold. Run on demand or from CI/ops tooling:
 *
 *   pnpm tsx scripts/ops/verify-db-backup.ts
 *
 * Exit codes:
 *   0  backup is fresh (within BACKUP_MAX_AGE_HOURS)
 *   1  backup is stale, in the future, or unverifiable (fails closed)
 *   2  bad invocation / unexpected error
 *
 * Env:
 *   BACKUP_MAX_AGE_HOURS   freshness threshold in hours (default 24)
 *   RAILWAY_API_TOKEN      required to read Railway backup metadata; when
 *                          absent the check fails closed (see the cron at
 *                          apps/api/src/modules/ops/backup-verify.cron.ts and
 *                          SESSION_17_DECISIONS.md for the Railway-API
 *                          follow-up — the timestamp fetch is intentionally
 *                          not guessed here).
 *
 * Shares the exact decision logic the in-process daily cron uses
 * (assessBackupFreshness) so the CLI and the cron can never disagree.
 */
import { assessBackupFreshness } from '../../apps/api/src/modules/ops/backup-verify.logic.js';

async function fetchLastBackupAt(): Promise<{ at: Date | null; source: string }> {
  const token = process.env.RAILWAY_API_TOKEN?.trim();
  if (!token) {
    return { at: null, source: 'unconfigured' };
  }
  // TODO(ops): call the Railway backups API and parse the latest backup
  // createdAt. Until confirmed against the live project, fail closed rather
  // than guess the GraphQL shape.
  return { at: null, source: 'railway-api-unwired' };
}

async function main(): Promise<number> {
  const maxAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? '24');
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    process.stderr.write(`Invalid BACKUP_MAX_AGE_HOURS: ${process.env.BACKUP_MAX_AGE_HOURS}\n`);
    return 2;
  }

  const { at, source } = await fetchLastBackupAt();
  const result = assessBackupFreshness(at, new Date(), maxAgeHours);

  const line = JSON.stringify({
    check: 'db-backup-freshness',
    ok: result.ok,
    ageHours: result.ageHours,
    maxAgeHours,
    source,
    reason: result.reason,
  });
  process.stdout.write(`${line}\n`);

  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `verify-db-backup failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(2);
  });
