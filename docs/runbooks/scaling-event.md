# Runbook — Scaling Event (Traffic Spike)

**Owner:** _on-call engineer_
**Last reviewed:** 2026-05-12

---

A scaling event is any sustained surge that takes a service close to its limits: CPU > 80% for 5+ min, memory > 80%, request rate > 2× baseline, DB connection pool saturated.

## 1. Detect

### 1a. Prometheus / Grafana

The 17A metrics emit on `/metrics`:

```
# CPU per process
towdispatch_api_process_cpu_user_seconds_total
towdispatch_api_process_cpu_system_seconds_total

# Resident memory
towdispatch_api_process_resident_memory_bytes

# Request rate by route
http_requests_total

# Request latency
http_request_duration_seconds

# DB query latency
db_query_duration_seconds
```

Scrape interval: 15s (default Prometheus). Dashboard lives at `https://grafana.towdispatch.com/d/api-overview` (Phase 1 prerequisite — see `docs/observability.md`).

### 1b. Quick CLI signals

```bash
# Live request rate (last 60s, per route) — pull from prom-client directly
curl -sf https://api.towdispatch.com/metrics | \
  awk '/^http_requests_total/ && /200/ {print}' | head -20

# Process resident memory
curl -sf https://api.towdispatch.com/metrics | grep towdispatch_api_process_resident_memory_bytes

# DB connection pool (run from a host with admin DB access)
psql "$DATABASE_ADMIN_URL" -c "
SELECT application_name, COUNT(*) AS conns
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY application_name;"
```

### 1c. PagerDuty thresholds (from `docs/observability.md`)

| Metric | Page threshold |
|---|---|
| API p99 latency | > 1s sustained 5 min |
| 5xx rate | > 1% sustained 5 min |
| DB connection pool usage | > 80% sustained 5 min |
| Process resident memory | > 80% of container limit sustained 5 min |
| Disk free | < 20% |
| Motor-club gateway queue depth | > 1000 |
| Failed-login spike | > 100/min (potential attack — see security-incident.md) |

---

## 2. Scale up — Railway

Railway is the current deploy platform (per build plan). Manual horizontal scale:

```bash
# Inspect current replica count
railway status --service api

# Scale the API service to 3 replicas
railway scale --service api --replicas 3

# Same for web
railway scale --service web --replicas 3
```

Vertical scale (when CPU is the binding limit on a single replica):

```bash
# Bump the plan tier — `pro-small` → `pro-medium`
railway plan --service api --tier pro-medium
```

Postgres scale (when DB is the bottleneck):

```bash
# Railway Postgres add-on: increase max connections via the dashboard.
# Default is 100; bump to 200 with the larger plan.
# The app pool max is 20 per process (apps/api/src/database/database.module.ts):
# at 3 replicas that's 60 in use; staying < 80% of 100 is the constraint.
```

If autoscaling is in place (Phase 1): the same env vars (`RAILWAY_REPLICA_COUNT_MIN`, `RAILWAY_REPLICA_COUNT_MAX`) on the service definition.

---

## 3. Scale up — AWS (Phase 1 path)

AWS migration is Phase 1 per the build plan. The intended target architecture:

- API: ECS Fargate behind an ALB. Auto-scaling group keyed on `RequestCountPerTarget` and CPU.
- Web: Vercel (or CloudFront + S3 + Lambda@Edge for the API routes).
- Postgres: RDS Aurora Postgres-compatible.
- Redis: ElastiCache.
- S3 for tenant uploads.

Scale commands (when this lands):

```bash
# Update the ECS service desired count
aws ecs update-service \
  --cluster towdispatch-prod \
  --service api \
  --desired-count 6

# RDS read replica for read-heavy traffic
aws rds create-db-instance-read-replica \
  --db-instance-identifier api-read-1 \
  --source-db-instance-identifier api-primary
```

The current repo is single-replica + single-DB. Anything beyond ~50 concurrent dispatchers in production hits Phase 1 territory.

---

## 4. When to call in additional support

| Trigger | Who |
|---|---|
| SEV-1 spike + scale-up command doesn't relieve pressure in 10 min | Founder + senior engineer (off-hours OK) |
| Sustained DB CPU > 90% even after vertical scale | DBA on retainer (Phase 1: confirm contract) |
| Suspected DDoS or attack pattern (see `docs/runbooks/security-incident.md`) | Founder + Cloudflare ops (Phase 1) |

---

## 5. Reverting after the event

```bash
# Scale back to baseline once metrics return to normal for 30 min
railway scale --service api --replicas 1
railway scale --service web --replicas 1
```

File a post-mortem (template in `docs/runbooks/incident-response.md` §5) so the scaling response gets faster next time.

---

## Last reviewed

2026-05-12 — Session 17C. Railway is the current platform; AWS is Phase 1.
