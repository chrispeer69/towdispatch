# Runbook — Motor Club Gateway Down

**Owner:** _on-call engineer + dispatch operations lead_
**Last reviewed:** 2026-05-12

---

The motor club gateway is the inbound dispatch path from Agero (and, in Phase 1, Allstate / Honk / Quest / Geico / USAC / State Farm). When it's degraded, jobs that should arrive automatically don't — dispatchers have to take the call by phone instead.

## 1. Detect

### 1a. Dashboard signal

The dispatch board surfaces a "Motor club: degraded" banner when the most recent inbound dispatch is > 5 minutes older than expected. The threshold lives in `apps/web/src/app/(app)/dispatch/dispatch-state.ts` (`MOTOR_CLUB_FRESHNESS_THRESHOLD_MS`, Phase 1 wiring; for now this is read by Sentry alert on the API side).

### 1b. Sentry alert

The Sentry rule that fires:

```
event.message:"motor_club_dispatch_failed"
  OR (event.message:"slow endpoint" event.tags.route:"/motor-club/*" event.tags.durationMs:>3000)
```

Routes to PagerDuty SEV-2.

### 1c. Queue depth query

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Inbound dispatches per network in the last hour, by status
SELECT
  network,
  COUNT(*) FILTER (WHERE created_at > now() - interval '5 minutes') AS last_5m,
  COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_1h,
  COUNT(*) FILTER (WHERE imported = false) AS pending
FROM motor_club_dispatches
GROUP BY network
ORDER BY pending DESC;
SQL
```

**Page when:** `pending > 1000` in a single network OR `last_5m = 0` for a normally-busy network during business hours.

### 1d. Outbound stub outbox (dev/staging only)

```bash
curl -sf https://api.towdispatch.com/motor-club/agero/_test/outbox | jq 'length, .[-5:]'
```

Production runs the real Agero provider, not the stub; this endpoint is BadRequest in `NODE_ENV=production` (see `apps/api/src/integrations/motor-club/motor-club.controller.ts`).

---

## 2. Confirm it's the gateway, not us

Before paging Agero ops:

```bash
# 1. Our process is healthy?
curl -sf https://api.towdispatch.com/ready

# 2. Our worker queue is draining?
psql "$DATABASE_ADMIN_URL" -c "
SELECT status, COUNT(*) FROM motor_club_dispatches
WHERE created_at > now() - interval '10 minutes'
GROUP BY status;"

# 3. Their dashboard?
# Agero partner portal: https://partners.agero.com/  (Phase 1 — credential rotation log)
```

If our process is healthy and Agero's partner portal shows their side is OK but our `last_5m = 0`: it's a credential or whitelist issue. Check `tenants.motor_club_credentials.agero.api_key` rotation date (see `docs/runbooks/secrets-rotation.md`).

---

## 3. Fail over to manual dispatch

### 3a. Mark the gateway as degraded

Flip the `motor_club_gateway_status` feature flag (Phase 1 — until the flag service is in place, mark via SQL so the web app banner fires):

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
INSERT INTO system_flags (key, value, updated_at)
VALUES ('motor_club_gateway_status', 'degraded', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
SQL
```

> The `system_flags` table is a Phase 1 prerequisite. Today, communicate manually via the operations channel (§4).

### 3b. Tell operators

Send the message in §4 immediately. Operators switch to phone intake — Agero will call them directly with each dispatch, and dispatchers use the regular `/intake` form to enter the job by hand. Tag every manually-entered job's `notes` field with `MANUAL-AGERO-<date>` so reconciliation can spot them.

---

## 4. Operator communication template

Send via Slack #dispatch-ops, SMS to all on-shift dispatchers, and email to the tenant owner:

```
SUBJECT: Motor club dispatch degraded — manual intake required (since HH:MM ET)

The Agero electronic dispatch gateway is currently degraded — we are not
receiving automatic dispatches. Until further notice:

1. Agero will call your dispatch phone directly with each job.
2. Enter the job manually via the Intake screen (top nav).
3. Tag the notes field with: MANUAL-AGERO-YYYY-MM-DD
4. Service the job normally; payment will reconcile when the gateway
   recovers.

We expect resolution within 1 hour. Next update at HH:MM ET.

— Tow Dispatch operations
```

When the gateway recovers, send an "all clear" with the same channels.

---

## 5. Replay queued dispatches after recovery

Once `/motor-club/agero/dispatch` returns 200 and the queue stops growing:

### 5a. Check what's queued

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
SELECT id, tenant_id, network, network_external_id, created_at
FROM motor_club_dispatches
WHERE imported = false
  AND created_at < now() - interval '5 minutes'
ORDER BY created_at;
SQL
```

### 5b. Trigger replay

Phase 1 will ship a `POST /motor-club/agero/replay` endpoint that walks `motor_club_dispatches WHERE imported = false` and re-runs the dispatch handler. Until that exists, replay manually:

```bash
# Per-row: re-trigger the dispatch handler with the same payload
psql "$DATABASE_ADMIN_URL" -t -A -F'|' <<'SQL' | \
  while IFS='|' read -r tenant_id external_id payload; do
    curl -sf -X POST https://api.towdispatch.com/motor-club/agero/dispatch \
      -H 'content-type: application/json' \
      -d "$payload"
  done
SELECT tenant_id, network_external_id,
  jsonb_build_object(
    'tenantId', tenant_id,
    'externalId', network_external_id,
    'service', 'tow',
    'customer', jsonb_build_object('name', 'replay'),
    'pickup', jsonb_build_object('address', 'replay')
  )::text
FROM motor_club_dispatches
WHERE imported = false
ORDER BY created_at;
SQL
```

(The payload field is sparse on purpose — the dispatch handler upserts on `external_id` so the replay is idempotent.)

### 5c. Lift the degraded banner

```bash
psql "$DATABASE_ADMIN_URL" -c "
DELETE FROM system_flags WHERE key = 'motor_club_gateway_status';"
```

Send the all-clear message (§4 template).

---

## 6. Reconciliation after the incident

```bash
psql "$DATABASE_ADMIN_URL" <<'SQL'
-- Jobs created during the degraded window that were tagged MANUAL-AGERO-*
SELECT id, tenant_id, job_number, created_at, notes
FROM jobs
WHERE notes ILIKE '%MANUAL-AGERO-%'
  AND created_at >= '<incident-start>'
  AND created_at <= '<incident-end>'
ORDER BY created_at;

-- Agero dispatches received during the same window
SELECT id, tenant_id, network_external_id, created_at
FROM motor_club_dispatches
WHERE network = 'agero'
  AND created_at >= '<incident-start>'
  AND created_at <= '<incident-end>';
SQL
```

For each MANUAL-tagged job, find the matching Agero dispatch by customer phone + pickup address. Link them by stamping `jobs.external_source='agero'` + `jobs.external_id=<dispatch.network_external_id>`. This makes the job billable to Agero rather than to the customer.

The reconciliation report from Session 16's Towbook import (`apps/api/src/modules/import/reconciliation.service.ts`) shares its pattern — wire a `motor-club-reconcile` endpoint that takes the incident window and produces the same `missing / orphaned / drift` buckets. **Phase 1 deliverable.**

---

## Last reviewed

2026-05-12 — Session 17C. The gateway runs against the in-memory stub. Live Agero ARES integration is Phase 1; replay endpoint is Phase 1.
