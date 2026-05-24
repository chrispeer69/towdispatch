# Service Level Objectives (SLOs)

_Phase 0 hardening (Session 17). These are the reliability targets we commit
to and measure against. They are intentionally modest for a single-region
early-stage SaaS — raise them as the platform matures._

## Targets

| Service | SLI | SLO | Measurement window |
|---------|-----|-----|--------------------|
| **API** | Availability (non-5xx / total, on `/` and authed routes; excludes 4xx) | **99.5%** | rolling 30 days |
| **API** | Latency — p95 request duration | **< 500 ms** | rolling 30 days |
| **Web** | Availability (successful page loads / total) | **99.0%** | rolling 30 days |

Health/readiness probes (`/health`, `/ready`) and synthetic smoke errors
(`smoke_test:true`) are **excluded** from SLI numerators/denominators.

## Error budget

Availability SLO → allowed downtime (error budget) per 30-day window:

| SLO    | Budget (30d) | Budget (per day) |
|--------|--------------|------------------|
| 99.5%  | ~3h 39m      | ~7.2 min         |
| 99.0%  | ~7h 18m      | ~14.4 min        |

**Policy:** when a month's error budget is exhausted, non-essential feature
work pauses and the next session prioritizes reliability (the failing SLI's
root cause) until the budget recovers.

## How to measure

### API availability + latency (Sentry)

- **Latency (p95):** Sentry Performance → Transactions, filter
  `transaction.op:http.server`, view the **p95 duration** column. Tag filters:
  `environment:production`. The API samples traces at `tracesSampleRate 0.1`
  in production (`SentryService`), so p95 is from a 10% sample — adequate for
  trend, not for absolute SLA billing.
- **Availability (error rate):** Sentry → Issues, `level:error
  environment:production`, exclude `smoke_test:true`. Cross-reference 5xx
  count against total request count from the access logs (the
  `LoggingInterceptor` emits one structured line per request with `status`).

### API availability (Railway)

- Railway → service → **Metrics**: HTTP 5xx rate and request count. Railway's
  healthcheck hits `/health`; deploy gating already probes `/health` then
  `/ready` (`scripts/deploy.sh`).

### Web availability (Railway + Sentry)

- Railway web service **Metrics** for 5xx + restarts.
- `@sentry/nextjs` (Session 17) reports client + server errors once
  `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` are set; group by route to find the
  worst offenders.

### Prometheus (in-process)

- `GET /metrics` (Prometheus exposition, `HealthMetricsController`) exposes
  request counters/histograms for scraping by an external Prometheus/Grafana
  if/when one is attached. Use `histogram_quantile(0.95, ...)` for p95.

## Alerting

- **Backup freshness:** `BackupVerifyCron` (daily) raises
  `alert:backup_verify_failed` in Sentry if the most recent DB backup is older
  than `BACKUP_MAX_AGE_HOURS` (default 24). Route this tag to the ops channel.
- **Crash spikes:** Sentry alert rule on error-event rate, **excluding**
  `smoke_test:true` so synthetic crashes never page on-call.
- **Probe failures:** Railway deploy aborts if `/health` or `/ready` fail for
  60s (`scripts/deploy.sh`), keeping the previous replica serving traffic.

## Review cadence

Reviewed at the start of each ops-focused session. When an SLO is changed,
update this doc and note the rationale in the session decision log.
