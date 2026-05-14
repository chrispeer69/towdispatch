# Runbook — Backup Strategy

**Owner:** _founder + on-call engineer_
**Last reviewed:** 2026-05-12

---

What gets backed up, where, how often, retained how long, and how to verify.

## Postgres

### Schedule

| Backup type | Frequency | Retention |
|---|---|---|
| Full `pg_dump` (custom format, gzipped) | Every 6 hours | 14 days |
| Daily snapshot | Once at 03:00 UTC | 90 days |
| Monthly snapshot | First of month at 03:00 UTC | 13 months |
| WAL archive (Phase 1) | Continuous | 30 days (point-in-time recovery window) |

### Cron — current

The 6-hourly + daily + monthly schedule is run by `scripts/backup-postgres.sh` (a Phase 1 deliverable; the script doesn't exist yet — see §"Open work" below). The schedule lives in Railway's cron add-on (or GitHub Actions workflow until then).

Sample crontab the script should install:

```
# Every 6 hours
0 */6 * * * /usr/local/bin/backup-postgres.sh hourly

# Daily at 03:00 UTC
0 3 * * * /usr/local/bin/backup-postgres.sh daily

# Monthly at 03:00 UTC on the 1st
0 3 1 * * /usr/local/bin/backup-postgres.sh monthly
```

### Bucket layout

```
s3://ustowdispatch-backups/postgres/
├── hourly/   YYYY/MM/DD/HH-pg_dump.sql.gz       (14-day TTL via S3 lifecycle rule)
├── daily/    YYYY/MM/DD-pg_dump.sql.gz          (90-day TTL)
└── monthly/  YYYY/MM-pg_dump.sql.gz             (390-day TTL; "monthly:" prefix preserved manually for the 13th)
```

S3 lifecycle rules enforce retention; the script doesn't delete old files itself.

### Verification

Restore test runs **monthly** against a staging DB. Procedure: `docs/runbooks/database-restore.md` §5.

A backup that's never been restored isn't a backup.

---

## Tenant uploads (S3)

### What's in the bucket

`s3://ustowdispatch-tenants/<tenant-id>/`:
- `logo.png` and `brand-mark.png` (the per-tenant branding)
- `job/<job-id>/photos/<uuid>.jpg|png|heic` (Session 6 driver photos)
- `job/<job-id>/signatures/<uuid>.png` (Session 6 customer signatures)
- `dvirs/<dvir-id>/photos/<uuid>.jpg` (Session 8 fleet documents)
- `documents/<doc-id>` (Session 8 document vault)
- `import-bundles/<run-id>.zip` (Session 16 Towbook bundles uploaded for audit)

### Retention

| Path | Retention |
|---|---|
| `logo.png`, `brand-mark.png` | Indefinite while tenant is active; 90 days after `deleted_at` is set |
| `job/.../photos/*` | 7 years (regulatory) |
| `job/.../signatures/*` | 7 years (regulatory) |
| `dvirs/.../photos/*` | 1 year (DOT-aligned) |
| `documents/*` | Indefinite while tenant is active |
| `import-bundles/*.zip` | 90 days |

### Versioning + lifecycle

S3 bucket should have:
- **Versioning enabled** (recover deleted objects)
- **Default encryption: SSE-S3** (Phase 1: SSE-KMS with a customer-managed key)
- **Object lock: not set** on tenant uploads (would prevent legit deletes); **on** for `s3://ustowdispatch-incidents/` (forensic captures, 7-year object lock)
- **Lifecycle rules** to enforce retentions above

### Backup of S3

S3 itself is 11-nines durable; no separate backup. **Cross-region replication is Phase 1** (`ustowdispatch-tenants` → `ustowdispatch-tenants-dr` in `us-west-2`) for disaster recovery on the bucket level. RPO for tenant uploads is "what S3 says it is" plus the replication lag.

---

## Redis

**Not backed up.** Redis holds rate-limiter counters, dispatch socket pub/sub, and session-bookkeeping caches. None of that is durable state — Postgres is the canonical store. Losing Redis means rate-limit counters reset and dispatchers reconnect their sockets. No data loss.

The Redis add-on does keep an AOF (append-only file) per the `docker-compose.yml` (`--appendonly yes`) for crash recovery. That's it.

---

## Sentry

Sentry retains errors and performance traces per the configured plan (Phase 1 — currently no Sentry project provisioned, so retention is whatever Sentry's free tier provides).

We do **not** back up Sentry. If Sentry is unavailable, errors continue logging to pino → stdout, which the deploy platform retains for 7 days. The Sentry hook is no-op-when-disabled (`apps/api/src/common/observability/sentry.service.ts`).

---

## Application logs

| Source | Retention | Location |
|---|---|---|
| API pino logs (stdout) | 7 days (Railway) | Railway log retention; longer term via the Sentry tier |
| Web Next.js logs | 7 days (Railway) | Same |
| nginx / ALB access logs | 30 days | Phase 1: ALB logs to S3 |
| audit_log table | Indefinite | Postgres; appended to via the `fn_audit_log()` trigger (Session 2.0 / 0004_audit_trigger.sql) |

The `audit_log` table is the long-term source of truth for "who did what when". It's append-only by trigger; even direct DB modifications get captured.

---

## Open work (Phase 1 prerequisites)

The strategy above assumes infrastructure that doesn't fully exist yet in this codebase:

1. `scripts/backup-postgres.sh` — the cron script. Today, backups are whatever Railway provides automatically (daily snapshot, 30-day retention per Railway).
2. `s3://ustowdispatch-backups` bucket with the lifecycle rules.
3. Cross-region replication for `s3://ustowdispatch-tenants`.
4. WAL archiving for PITR (`archive_mode = on`, S3-backed `archive_command`).
5. Monthly restore-test cron — schedule + alerting if it fails.
6. SSE-KMS with a customer-managed key for tenant uploads.
7. ALB access log archival (when we move to AWS).

Until those land, the **effective backup posture** is: daily Railway snapshot, no PITR, no cross-region replication, single-AZ Postgres. Acceptable for the founder's two tenants in initial production; not acceptable at 10× growth.

---

## Last reviewed

2026-05-12 — Session 17C.
