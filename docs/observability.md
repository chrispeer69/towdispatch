# Observability

What's emitted, where to look, when to page. Reference companion to the runbooks in `docs/runbooks/`.

## Logs

All API logs are JSON via pino (`apps/api/src/config/config.service.ts`). Every log line includes:

```
timestamp, level, service="ustowdispatch-api", env, request_id, tenant_id, user_id,
method, path, status, duration_ms, ip, user_agent, error (when level >= error)
```

PII (`password`, `passwordHash`, `email`, `phone`, `totpSecret`, auth headers, cookies) is redacted by pino's `redact:` config.

Log storage today: Railway retains 7 days of stdout. The audit_log Postgres table is the long-term source of truth for "who did what when" (append-only, never deleted).

## Metrics — `/metrics`

The 17A observability layer exposes a Prometheus endpoint:

```
GET https://api.ustowdispatch.com/metrics
```

Default Node metrics (event-loop lag, GC, memory, FDs) plus the application counters:

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | method, route, status |
| `http_request_duration_seconds` | histogram | method, route, status |
| `db_query_duration_seconds` | histogram | op |
| `auth_logins_total` | counter | outcome |
| `auth_lockouts_total` | counter | — |
| `import_runs_total` | counter | mode, status |

Scrape interval: 15s (default Prometheus / Grafana cloud). Dashboard at `https://grafana.ustowdispatch.com/d/api-overview` (Phase 1 prerequisite).

## Traces

Sentry is the trace + error sink (`apps/api/src/common/observability/sentry.service.ts`). DSN-driven; no-op when empty. Every event is tagged with `request_id`, `tenant_id`, `user_id`, `service`, `environment`, `release` (the `RELEASE_TAG` env var, set per deploy).

PII denylist runs `beforeSend` and scrubs: `email`, `phone`, `phoneAlt`, `passwordHash`, `refreshToken`, `totpSecret`. Default Stripe-DSN scrubbing is on top of that.

`tracesSampleRate`: 0.1 in production, 0 elsewhere.

## Alerts

| Alert | Threshold | Channel | Severity |
|---|---|---|---|
| API p99 latency | > 1s for 5 min | PagerDuty + Slack #incidents | SEV-2 |
| 5xx rate | > 1% of requests for 5 min | PagerDuty + Slack #incidents | SEV-2 |
| API up (synthetic) | /health returns non-200 for > 30s | PagerDuty | SEV-1 |
| DB ready | /ready returns 503 for > 30s | PagerDuty | SEV-1 |
| Redis ready | /ready 503 (redis check) > 30s | Slack only (graceful degradation) | SEV-3 |
| DB connection pool | > 80% saturated for 5 min | PagerDuty + Slack | SEV-2 |
| Process resident memory | > 80% of container limit for 5 min | Slack only initially; PagerDuty if sustained 15 min | SEV-3 → SEV-2 |
| Disk free | < 20% on the API host | PagerDuty | SEV-2 |
| Motor-club queue depth | > 1000 pending in a single network | PagerDuty (oncall + dispatch lead) | SEV-2 |
| Failed-login spike | > 100 / minute | PagerDuty (security incident — see runbook) | SEV-1 |
| Auth lockouts | > 50 / hour | Slack #security | SEV-3 |
| Slow query log | any > 250 ms | Sentry capture, no page | INFO |
| Slow endpoint log | any > 1000 ms | Sentry capture, no page | INFO |
| Sentry error rate | > 10× baseline for 5 min | Slack #incidents | SEV-3 → escalate |

### Routing

- **PagerDuty SEV-1:** pages oncall + founder (phone + SMS + email)
- **PagerDuty SEV-2:** pages oncall (email + SMS)
- **PagerDuty SEV-3:** no page; ticket auto-created
- **Slack channels:** `#incidents` (anything live), `#dispatch-ops` (motor-club + payment fallback), `#security` (lockouts, RLS, auth)

All four channels are Phase 1 prerequisites — PagerDuty service config + Sentry alert rules + Grafana dashboards + Slack webhooks. The thresholds are the contract; the routing service wires up to deliver them.

## Health endpoints

```
GET /health    Liveness    Always 200 if the API process is up
GET /ready     Readiness   200 if DB + Redis are reachable; 503 otherwise
GET /metrics   Prometheus  Text exposition format
```

Aliases preserved for the existing deploy pipeline: `/healthz` ↔ `/health`, `/readyz` ↔ `/ready`.

## Latency budgets (the contract)

| Path | p50 budget | p99 budget |
|---|---|---|
| API read (GET) | < 100 ms | < 500 ms |
| API write (POST/PATCH/DELETE) | < 200 ms | < 1000 ms |
| Real-time push (Socket.IO) end-to-end | < 1.5 s | < 1.5 s |

Exceeding the p99 budget for any sustained 5-minute window fires a SEV-2 page.

## Last reviewed

2026-05-12 — Session 17C.
