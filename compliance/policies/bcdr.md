# Business Continuity & Disaster Recovery (BCDR) Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual (+ after every drill)

## Objectives

| Metric | Target (current) | Target (Phase 1) |
|---|---|---|
| **RPO** (max data loss) | ≤ 24 hours (daily backup) | ~5 minutes (WAL archiving / PITR) |
| **RTO** (max downtime to restore) | ≤ 4 hours | ≤ 1 hour |

## Backups

- **What:** PostgreSQL (primary datastore). Redis is a cache/queue and is
  reconstructable; it is not part of RPO.
- **Schedule:** Railway managed Postgres automated **daily** backups.
- **Retention:** per Railway plan; minimum 7 daily backups retained. (PITR /
  WAL archiving to be enabled in Phase 1, per `ARCHITECTURE.md §11`.)
- **Verification:** `scripts/compliance/verify-backup.ts` asserts the most
  recent backup is < 24h old (run in `pnpm compliance:check`; `--strict` to
  enforce). Configure `BACKUP_STATUS_URL` or `RAILWAY_API_TOKEN` +
  `RAILWAY_PROJECT_ID` so the check has a source.

## Restore procedure

1. Declare a recovery event (Incident Response, typically Sev-1/2).
2. Provision a target (Railway managed Postgres) in a scratch/standby project.
3. Restore the latest valid backup via the Railway dashboard/CLI.
4. Point the API at the restored DB (update `DATABASE_URL` /
   `DATABASE_ADMIN_URL`); run pending migrations if any.
5. Verify: `/ready` (DB ping), run `rls.spec.ts` against the restore, spot-check
   recent jobs/invoices for a known tenant.
6. Cut over; communicate per Incident Response; record RTO achieved.

## Recovery testing

- **Annual restore drill.** Restore the latest backup to a scratch environment,
  measure RTO, validate data integrity, and file the result (date, RTO, issues)
  in `compliance/evidence/`. Findings feed the next risk assessment.

## Continuity

- The platform is multi-instance behind Railway; a single instance failure does
  not cause an outage. Region-level failover is a Phase 1+ item
  (`ARCHITECTURE.md §11`).
