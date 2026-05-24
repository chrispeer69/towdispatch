# Monitoring & Alerting Policy

**Owner:** CTO · **Approved:** 2026-05-24 · **Review cadence:** annual

Covers SOC 2 CC4.1 (monitoring) and CC7.2 (anomaly detection), plus PCI Req 10.

## What we monitor

| Signal | Source | Surface |
|---|---|---|
| Application errors / APM | Sentry (`SENTRY_DSN`) | Sentry project |
| Request/latency/throughput metrics | `prom-client` `/metrics` | metrics scraper / dashboard |
| Liveness / readiness | `/health`, `/ready` (incl. region block) | uptime monitor, `monitoring-sample.ts` |
| Slow queries / slow endpoints | `SLOW_QUERY_THRESHOLD_MS`, `SLOW_ENDPOINT_THRESHOLD_MS` | logs WARN |
| Audit-trail anomalies | `audit_log` + `users` | `GET /admin/audit-log/anomalies` |
| Dependency vulnerabilities | `pnpm audit` / Dependabot | weekly scan |

## Audit anomaly surface (Session 40)

`GET /admin/audit-log/anomalies` is an advisory, tenant-scoped (RLS) read that
surfaces three operating-effectiveness signals for operators/auditors:

- **Admin deletes** — DELETE actions by owner/admin actors in the window.
- **Off-hours admin activity** — owner/admin actions in the off-hours UTC band
  (default 22:00–06:00).
- **Failed-login spikes** — accounts with `failed_login_count ≥ threshold`
  (default 5) or an active lockout.

It flags; it does not block. Roles: OWNER / ADMIN / AUDITOR.

## Alert thresholds (initial)

| Condition | Threshold | Action |
|---|---|---|
| Unhandled error rate | > 1% of requests over 5 min | page on-call |
| Health/ready failing | 2 consecutive failures | page on-call |
| p95 endpoint latency | > 1000 ms sustained 10 min | investigate |
| Failed-login spike (per account) | ≥ 5 in 15 min | review (auto-lockout already applies) |
| Off-hours admin DELETE | any | review next business day |
| Backup age | > 24h (RPO) | page on-call |
| Critical/high vulnerability | any unremediated | triage within SLA |

Synthetic/smoke errors are tagged `smoke_test=true` (`SMOKE_DEBUG_*`) and excluded
from paging.

## Evidence

- Daily `monitoring-sample.ts` health samples via `compliance:collect`.
- Sentry issue history; alert-rule configuration export.
- `audit_log` retention (7 years) is the durable record behind the anomaly surface.
