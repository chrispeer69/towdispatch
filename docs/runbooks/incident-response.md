# Runbook — Incident Response

**Owner:** _on-call engineer_
**Last reviewed:** 2026-05-12

---

## 1. Declare an incident

### Severity levels

| Level | Trigger | Response time |
|---|---|---|
| **SEV-1** | Production fully down: API 5xx > 50%, web is unreachable, DB unreachable, every tenant affected | < 5 minutes |
| **SEV-2** | Production degraded: API p99 > 5s for >10 min, a single high-volume feature (dispatch / billing / motor-club) down for one or more tenants | < 15 minutes |
| **SEV-3** | A single non-critical feature broken (reports, accounting sync drift, single tenant edge case) | Next business day |

### Notify

| Sev | Who | Channel |
|---|---|---|
| SEV-1 | Founder (Chris) + on-call + every other engineer | PagerDuty page + Slack #incidents (mention `@channel`) + SMS via Twilio fallback |
| SEV-2 | Founder + on-call | PagerDuty page + Slack #incidents |
| SEV-3 | On-call | Slack #incidents (no page) |

> PagerDuty + Slack #incidents are Phase 1 prerequisites — see `docs/runbooks/secrets-rotation.md` for the env vars they consume. While these aren't wired, page the founder by phone and email `incidents@towdispatch.com`.

### Status page

A public status page is a **Phase 1 prerequisite** (https://status.towdispatch.com on Atlassian Statuspage). Until it lands, communicate via direct email to affected tenants — the per-tenant contact list lives in `SELECT name, owner_email FROM tenants` (queried via the admin pool).

---

## 2. Initial triage commands

### 2a. Check service liveness

```bash
# Public probe endpoints (see apps/api/src/common/observability/health-metrics.controller.ts)
curl -sf https://api.towdispatch.com/health
curl -sf https://api.towdispatch.com/ready
curl -sf https://api.towdispatch.com/healthz   # legacy alias
curl -sf https://api.towdispatch.com/readyz    # legacy alias

# Prometheus scrape — useful to eyeball if the host is up but reporting bad metrics
curl -s https://api.towdispatch.com/metrics | head -40
```

`/ready` returns 503 if either Postgres or Redis fails its ping. If `/health` returns 200 but `/ready` returns 503, the API process is up but a dependency is down — see §4.

### 2b. Pull recent errors from Sentry

```bash
# Set SENTRY_DSN's project slug in this command. Replace TIME_WINDOW with the incident window (e.g. 30m, 1h).
sentry-cli issues list --project towdispatch-api --max-rows 50 --query 'is:unresolved age:-30m'
```

If `sentry-cli` isn't installed: log into Sentry UI → project `towdispatch-api` → Issues → filter `age:-30m`. Group by request_id (every event carries `request_id`, `tenant_id`, `user_id` tags — set by `apps/api/src/common/observability/sentry.service.ts`).

### 2c. Count affected tenants

```bash
# Connect with the admin pool (DATABASE_ADMIN_URL)
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Tenants with any 5xx audit-log entry in the last hour
SELECT COUNT(DISTINCT tenant_id) AS affected_tenants
FROM audit_log
WHERE created_at > now() - interval '1 hour'
  AND (after_state::text ILIKE '%5%' AND action = 'INSERT');

-- Tenants with at least one in-flight job stuck in 'dispatched' > 30 min
-- (a real symptom of motor-club or socket layer wedging)
SELECT t.name, COUNT(*) AS stuck_jobs
FROM jobs j
JOIN tenants t ON t.id = j.tenant_id
WHERE j.status = 'dispatched'
  AND j.assigned_at < now() - interval '30 minutes'
GROUP BY t.name
ORDER BY stuck_jobs DESC;
SQL
```

### 2d. Check motor-club gateway queue depth

```bash
# Inbound queue (Agero dispatches awaiting processing)
psql "$DATABASE_ADMIN_URL" -c "
SELECT network, COUNT(*) AS pending
FROM motor_club_dispatches
WHERE created_at > now() - interval '1 hour'
  AND imported = false
GROUP BY network;"

# In-memory stub outbox (dev / staging — production replaces this with the real provider)
curl -sf https://api.towdispatch.com/motor-club/agero/_test/outbox | jq 'length'
```

Threshold: > 1000 pending in a single network in a 5-minute window pages oncall (see `docs/observability.md`).

### 2e. Database health

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Connection pool usage
SELECT COUNT(*) AS conns, COUNT(*) FILTER (WHERE state = 'active') AS active
FROM pg_stat_activity
WHERE datname = current_database();

-- Long-running queries
SELECT pid, now() - query_start AS duration, state, query
FROM pg_stat_activity
WHERE query_start < now() - interval '30 seconds'
  AND state <> 'idle'
ORDER BY duration DESC
LIMIT 10;

-- Replication lag (when streaming standby is in place — Phase 1)
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
SQL
```

---

## 3. Rollback procedure

### 3a. Identify the bad deploy

```bash
# Most recent deploys (assumes Railway as the deploy platform — see scripts/deploy.sh)
railway deployments --service api --limit 5
railway deployments --service web --limit 5

# Git SHAs and RELEASE_TAG values
git log --oneline --since='6 hours ago' origin/master
```

### 3b. Roll back the API or web service

```bash
# Roll back API to the previous good deployment
railway rollback --service api --deployment <PREVIOUS_DEPLOY_ID>

# Roll back web
railway rollback --service web --deployment <PREVIOUS_DEPLOY_ID>
```

If Railway is unreachable: redeploy the previous commit explicitly.

```bash
git checkout <previous-good-sha>
pnpm install --frozen-lockfile
pnpm --filter @towdispatch/api build
pnpm --filter @towdispatch/web build
# Push the artifact through the normal CI path with the previous SHA tagged as RELEASE_TAG
```

### 3c. Migration rollback

**Migrations are forward-only.** A migration that breaks production must be unwound by a new forward migration that reverses it — never by `git revert` of the SQL file. See `docs/runbooks/database-restore.md` § "Migration rollback".

### 3d. Cache and queue

Redis caches are tenant-scoped. After a rollback, flush the rate-limiter and dispatch cache to avoid serving stale data:

```bash
redis-cli FLUSHDB
```

Be cautious — this also wipes the `@nestjs/throttler` counters. The auth lockout state (in `users.locked_until` + `login_attempts` from 0019) lives in Postgres and survives.

---

## 4. When `/ready` returns 503

`/ready` reports `db: ok` and `redis: ok` only when both are reachable.

### 4a. DB unreachable

```bash
# From the API host
psql "$DATABASE_URL" -c "SELECT 1"

# From a different network path
psql "$DATABASE_ADMIN_URL" -c "SELECT 1"

# If neither responds: check Railway DB add-on status, AWS RDS console, etc.
```

If the DB is up but the app can't reach it: check `DATABASE_URL` env var, check the security group / network ACL, check the connection pool limits in `apps/api/src/database/database.module.ts` (max 20 connections per pool, 4 for admin).

### 4b. Redis unreachable

```bash
redis-cli -u "$REDIS_URL" PING
```

Redis being down disables rate limiting and dispatch socket pub/sub. The API continues to serve most requests but real-time updates will be wedged. SEV-2 if it persists; restart the Redis add-on.

---

## 5. Post-incident — post-mortem template

Within 48 hours of any SEV-1 or SEV-2, file a post-mortem at `docs/post-mortems/YYYY-MM-DD-short-name.md`. Use this template:

```markdown
# Post-mortem: <one-line summary>

**Date:** YYYY-MM-DD
**Severity:** SEV-1 / SEV-2 / SEV-3
**Duration:** Detected HH:MM UTC → Resolved HH:MM UTC (X minutes)
**Author:** <name>

## Impact
- Tenants affected:
- Records affected (jobs, customers, invoices):
- Revenue impact:
- User-visible behavior:

## Timeline (UTC)
- HH:MM — first signal (Sentry alert / PagerDuty page / customer report)
- HH:MM — triage started, oncall paged
- HH:MM — root cause hypothesised
- HH:MM — mitigation applied
- HH:MM — fully resolved
- HH:MM — all-clear declared

## Root cause
<plain language, no blame>

## What worked
<keep doing>

## What didn't
<process or tooling gaps — not people>

## Action items
- [ ] Owner / due date / what
- [ ] Owner / due date / what
```

Action items get filed as GitHub issues with the `incident-followup` label.

---

## 6. Communication during the incident

| Audience | Channel | Cadence |
|---|---|---|
| Internal engineering | Slack #incidents | every 15 min for SEV-1, 30 min for SEV-2 |
| Founder | Direct message + phone if SEV-1 | every status change |
| Affected tenants | Email from `incidents@towdispatch.com` | initial 15 min after declaration; updates every 30 min |
| Public status page | Atlassian Statuspage (Phase 1) | initial + status change |

Drafts for each go in `docs/runbooks/templates/` — see `motor-club-down.md` and `payment-processor-down.md` for examples.
