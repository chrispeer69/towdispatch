# Runbook — Database Restore

**Owner:** _on-call engineer_
**Last reviewed:** 2026-05-12

---

## RPO / RTO targets

| Metric | Target |
|---|---|
| **RPO** (recovery point objective) | 5 minutes — at most 5 minutes of writes lost |
| **RTO** (recovery time objective) | 1 hour — from "we need to restore" to "production traffic restored" |

These are Phase 1 targets per the build plan. Until WAL archiving is wired (§3 below) the effective RPO is the most recent `pg_dump` snapshot, which the cron runs every 6 hours — so a worst-case RPO of 6 hours today.

---

## 1. Backup location

Daily + 6-hourly snapshots are written to S3 by the backup cron. Bucket layout:

```
s3://towdispatch-backups/
├── postgres/
│   ├── YYYY/MM/DD/HH-MM-pg_dump.sql.gz   ← compressed pg_dump custom format
│   └── …
└── wal/                                   ← Phase 1: WAL archive for PITR
    └── …
```

Required env vars on the host running the cron (and on a workstation running an ad-hoc restore):

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
BACKUP_S3_BUCKET=towdispatch-backups
DATABASE_ADMIN_URL=postgres://towdispatch:…@host:5432/towdispatch
```

The cron script lives at `scripts/backup-postgres.sh` (Phase 1 deliverable — see `docs/runbooks/backup-strategy.md`).

---

## 2. Full restore from a pg_dump snapshot

### 2a. Identify the snapshot

```bash
aws s3 ls s3://towdispatch-backups/postgres/$(date -u +%Y/%m/%d)/ --human-readable
```

Pick the snapshot just **before** the incident time. Snapshots are named `HH-MM-pg_dump.sql.gz` in UTC.

### 2b. Download

```bash
aws s3 cp s3://towdispatch-backups/postgres/2026/05/12/06-00-pg_dump.sql.gz /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz
```

### 2c. Restore into a fresh staging DB first

**Never restore directly into production without a verification pass on staging.**

```bash
# Provision a fresh staging DB. On Railway: `railway service create postgres towdispatch-restore`.
export STAGING_URL='postgres://towdispatch:…@staging-host:5432/towdispatch_restore'

# pg_dump custom format — use pg_restore
# (If the snapshot is plain SQL: `psql "$STAGING_URL" < /tmp/restore.sql`)
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$STAGING_URL" \
  --verbose \
  /tmp/restore.sql
```

The `--clean --if-exists` flags make `pg_restore` idempotent — re-running it drops and recreates objects.

### 2d. Verify the restore

Run the verification queries from `docs/runbooks/incident-response.md` § 2c against the staging DB, then run these extra spot-checks:

```bash
psql "$STAGING_URL" <<'SQL'
-- Record counts that should be in the ballpark of production
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM users WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM invoices WHERE status NOT IN ('void');
SELECT COUNT(*) FROM payments WHERE status = 'received';

-- Audit log gap detection
SELECT MIN(created_at), MAX(created_at), COUNT(*) FROM audit_log;

-- The most recent activity per tenant
SELECT t.name, MAX(a.created_at) AS last_audit_at
FROM audit_log a JOIN tenants t ON t.id = a.tenant_id
GROUP BY t.name
ORDER BY last_audit_at DESC;
SQL
```

If counts look right and the most recent audit log entry is roughly when the snapshot was taken, the restore is good. Smoke-test the auth flow:

```bash
# Hit /ready against the staging API pointed at the restored DB
DATABASE_URL="$STAGING_URL" pnpm --filter @towdispatch/api start &
sleep 5
curl -sf http://localhost:3001/ready
curl -sf http://localhost:3001/health
```

### 2e. Cut over to production

Once staging verifies:

```bash
# 1. Put the API into maintenance mode (Phase 1 — until then, accept the brief outage)
# 2. Stop the API service so no new writes land
railway service stop api

# 3. Restore into prod
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DATABASE_ADMIN_URL" \
  --verbose \
  /tmp/restore.sql

# 4. Re-apply any migrations that landed AFTER the snapshot
#    (Snapshots include schema; if the prod DB was on migration N and the
#    snapshot was taken on migration M < N, apply M+1..N before restarting.)
pnpm --filter @towdispatch/db migrate

# 5. Restart the API
railway service start api

# 6. Verify
curl -sf https://api.towdispatch.com/ready
```

---

## 3. Point-in-time recovery (PITR) — Phase 1

PITR requires WAL archiving, which is **not yet wired in this repo**. The prerequisite work is:

1. Configure `archive_mode = on` and `archive_command` on the primary Postgres
2. Stand up an S3 bucket for WAL segments (`s3://towdispatch-backups/wal/`)
3. Provision a streaming standby (Railway provides this as an add-on; on AWS it's RDS Multi-AZ + read replica)
4. Wire the standby into the failover script at `scripts/failover-postgres.sh` (does not exist yet)

Until PITR lands, restore granularity is the most recent `pg_dump` snapshot.

---

## 4. Migration rollback

**Migrations are forward-only.** Both Drizzle-generated migrations (`packages/db/drizzle/`) and raw SQL (`packages/db/sql/0001…0019.sql`) are applied in lexicographic order by `packages/db/src/migrate.ts` and never rolled back automatically.

### Why forward-only

A rollback of a destructive migration (DROP COLUMN, DROP TABLE) requires the original data. The data is gone after the forward migration ran. You don't roll a migration back — you write a new forward migration that reverses the change.

### How to unwind a bad migration

1. Identify the migration number (e.g. `packages/db/sql/0019_auth_hardening.sql` added `users.lockout_streak`).
2. Write a new migration with the next number that performs the reverse:

```sql
-- packages/db/sql/0020_revert_auth_hardening.sql
-- Reverts 0019_auth_hardening.sql columns. Drops are non-destructive
-- because the only data in lockout_streak is the post-19 counter, which
-- the application can recompute.

ALTER TABLE users DROP COLUMN IF EXISTS lockout_streak;
ALTER TABLE sessions DROP COLUMN IF EXISTS family_id;
DROP TABLE IF EXISTS login_alert_emails_sent;
DROP TABLE IF EXISTS login_attempts;
```

3. Apply: `pnpm --filter @towdispatch/db migrate`.

### When a destructive forward migration is required

If you must drop a column that still has data:

1. Snapshot first: `pg_dump --table=<table> "$DATABASE_ADMIN_URL" > pre-drop-<table>-$(date -u +%FT%T).sql`
2. Stash the snapshot in `s3://towdispatch-backups/pre-migration/`
3. Land the migration
4. Keep the snapshot for at least 30 days

---

## 5. Testing a restore in staging without affecting production

```bash
# 1. Provision a temporary staging DB on Railway
railway service create postgres towdispatch-restore-test
export STAGING_URL=$(railway env get DATABASE_URL --service towdispatch-restore-test)

# 2. Pull the most recent prod snapshot
aws s3 cp s3://towdispatch-backups/postgres/$(date -u +%Y/%m/%d)/06-00-pg_dump.sql.gz - | gunzip > /tmp/restore.sql

# 3. Restore + verify (steps 2c, 2d above)

# 4. Tear down the temp DB when done
railway service delete towdispatch-restore-test
```

Schedule this dry-run **monthly** at minimum. A backup that's never been restored isn't a backup.

---

## 6. Local-dev reset

The fast path for dev work — wipes everything, fresh start:

```bash
pnpm --filter @towdispatch/db reset    # drops + recreates the dev DB
pnpm --filter @towdispatch/db migrate  # re-applies every migration
pnpm --filter @towdispatch/db seed     # seeds 2 test tenants + 6 users
```

`packages/db/src/reset.ts` refuses to run when `NODE_ENV=production` as a safety check.
