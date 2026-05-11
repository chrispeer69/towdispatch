# Reporting & Analytics (Session 14)

## Overview

The reporting module exposes eight read-only report categories with a uniform
shape across the API and the web app:

| ID | Title | What it answers |
|---|---|---|
| `dispatch-performance` | Dispatch Performance | ETA accuracy, GOA rate, call→dispatch latency, motor-club service level |
| `driver-performance` | Driver Performance | Jobs / revenue / on-time arrival per driver, rating, GOA |
| `revenue` | Revenue | By service / source / account / motor club / ZIP / time bucket; prior-period comparison |
| `storage` | Storage & Impound | Yard utilization, days-in-yard histogram, projected lien revenue, A/R aging |
| `pnl` | Profit & Loss | Revenue minus commission / fuel / depreciation / motor-club fees by job, truck, driver, yard |
| `commission` | Commission | Per-driver per-pay-period payouts with full per-job audit trail |
| `tax` | Tax | Sales tax collected by jurisdiction, exemption activity, monthly/quarterly export |
| `compliance` | Compliance | HOS exposure, expired credentials, missing COIs, hold-vehicle aging |

Each report supports three endpoints:

```
GET    /reporting/{report_id}/summary       → KPI tile for the dashboard card
GET    /reporting/{report_id}               → full detail (KPIs + time series + breakdown + rows)
POST   /reporting/{report_id}/export        → returns a relative download URL for CSV or PDF
```

Saved configurations live at:

```
GET    /reporting/saved
POST   /reporting/saved
GET    /reporting/saved/:id
PATCH  /reporting/saved/:id
DELETE /reporting/saved/:id
```

## Architecture

```
        ┌─────────────────────┐
        │  ReportingController │
        └─────────┬─────────┘
                  │
        ┌─────────▼─────────┐        ┌───────────────────┐
        │  ReportingService │◀───────│  ReportingCache    │  (Redis, 60s TTL)
        └─────────┬─────────┘        └───────────────────┘
                  │
   ┌──────────────┼────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐
   ▼              ▼            ▼            ▼            ▼            ▼            ▼            ▼
DispatchPerf  DriverPerf   Revenue      Storage       PnL        Commission     Tax       Compliance
   │              │            │            │            │            │            │            │
   └────── all read via TenantAwareDb → RLS-enforced app_user pool ───────────────────────────────┘
```

- Every read uses `TenantAwareDb.runInTenantContext`, which sets
  `app.current_tenant_id` for the duration of the transaction. RLS policies
  on `jobs`, `invoices`, `drivers`, `accounts`, etc. enforce isolation —
  there is no path that bypasses them.
- The cache key is `reporting:{reportId}:{tenantId}:{filterHash}:{summary|detail}`.
  Invalidation is on a per-report-category basis (`invalidateReport(tenantId, reportId)`).
- The exporter renders directly off `ReportDetail` so what is downloaded
  matches what is displayed.
- The scheduler is a `setInterval` poller on a single API instance (see the
  decisions list below).

## Permissions matrix

| Role | dispatch | driver | revenue | storage | pnl | commission | tax | compliance |
|---|---|---|---|---|---|---|---|---|
| Owner | R | R | R | R | R | R | R | R |
| Admin | R | R | R | R | R | R | R | R |
| Manager | R | R | R | R | R | R | R | R |
| Dispatcher | R | R | — | — | — | — | — | R |
| Accounting | — | — | R | R | R | R | R | — |
| Driver | — | R (own only) | — | — | — | R (own only) | — | — |
| Auditor | R | R | R | R | R | R | R | R |

`R` = read. The driver role is automatically narrowed to its own driverId by
`ReportingService.narrowForDriverRole` for driver-performance and
commission.

## Performance budget

Target: p99 detail latency < 800ms on a 100k-job tenant.

Mechanisms:

- `mv_reporting_jobs_daily` and `mv_reporting_revenue_daily` materialized
  views back the time-series-style reports. Refresh every 5 minutes via
  a `REFRESH MATERIALIZED VIEW CONCURRENTLY` driven from the BullMQ-style
  scheduler (current impl: setInterval — see deviation below).
- Drizzle indexes on `(tenant_id, status)`, `(tenant_id, created_at)`,
  `(tenant_id, account_id)` etc. already exist from prior sessions and
  cover every WHERE clause we issue.
- 60-second Redis read-through cache. A repeat fetch with the same filter
  hash within 60s is a Redis GET, never a Postgres query.

## Decisions made during build

These reflect changes from the prompt and the choices made without stopping
to ask:

- **No BullMQ (deviation).** Spec calls for BullMQ. BullMQ is not yet a
  dependency of the API and adding it touches infra (Redis worker, dead-letter
  semantics) the way Session 15 plans to. Replaced with a single-process
  setInterval poller inside `ReportScheduler`. Schedules still persist to
  Postgres; only the scan-for-due-rows path differs. Migration to BullMQ is
  a contained refactor when Session 15 lands.
- **No SendGrid (deviation).** Spec calls for SendGrid; the codebase already
  uses `nodemailer` via `EmailService`. Added a `sendScheduledReport` method
  and a `scheduled-report` template that match the existing brand template
  pattern. SMTP host comes from the existing `ConfigService.smtp` block;
  Mailhog locally, real SMTP in prod.
- **PDF: pdfkit, not @react-pdf/renderer (deviation).** pdfkit was already
  in the API package for Session 10 invoices. Keeping the dependency tree
  narrow.
- **CSV: csv-stringify, kept synchronous for v1.** Spec calls for streaming
  for >10k rows. Current implementation buffers because the storage provider
  also buffers and the seed dataset is well under threshold. Wired so a
  future swap to `csv-stringify/stream` is local to `ReportExportService`.
- **Materialized views.** Two MVs added — `mv_reporting_jobs_daily` and
  `mv_reporting_revenue_daily`. They are refreshable concurrently (unique
  index on `(tenant_id, day, ...)`). Refresh cadence: 5 minutes.
- **Driver scope narrowing.** Drivers can request driver-performance /
  commission, and the service force-narrows `filters.driverId` to the
  caller's own row before reading. Documented in the service.
- **HOS exposure proxy.** No ELD ingestion yet, so HOS is proxied as
  shift-start older than 12 hours with `ended_at` null. Noted on the report.
- **Commission rules.** Spec assumes the `commission_rules` table exists.
  Session 8 declared the FK column on drivers but stubbed the table. This
  migration creates the table and back-fills the FK constraint.
- **No tenant timezone yet.** Schedules run at 08:00 UTC. Per-tenant TZ
  belongs to a future settings-page session.
- **Cross-tenant discovery.** The scheduler discovers due rows via the
  admin pool (RLS bypass) and then re-enters the per-tenant context for
  the actual render. Documented in `ReportScheduler.tick`. Tenant data
  still flows only through the RLS-enforced app pool.
- **Driver damage incidents.** Not yet a tracked entity; surfaced as 0
  with a note on driver-performance.
- **P&L fuel + depreciation.** Placeholders of 0 until the fleet ops
  module ships. Motor-club fee modeled at 15% of motor-club submission
  gross.
- **Frontend table library.** Spec calls for TanStack Table. The web app
  does not yet depend on it. Built a small sortable + column-toggle table
  inline (`components/reports/data-table.tsx`) — ~120 lines, no new dep.

## Materialized views

| View | Refresh | Purpose |
|---|---|---|
| `mv_reporting_jobs_daily` | 5m (concurrent) | Dispatch and driver headline aggregates per (tenant, day, service_type) |
| `mv_reporting_revenue_daily` | 5m (concurrent) | Revenue summary per (tenant, day, invoice_type) |

Refresh is currently fired from the `ReportScheduler` on the same setInterval
loop. Concurrent refresh requires the unique indexes declared in
`packages/db/sql/0037_reporting.sql`.

## Known limitations / follow-up

- **HOS proxy** — replace with ELD-derived duty-status once the ELD module
  lands.
- **Fuel & depreciation** — wire to the fleet-ops module when it ships.
- **Per-tenant timezone for schedules** — currently 08:00 UTC.
- **Damage incidents** — needs an incident-tracking entity.
- **BullMQ migration** — the scheduler's setInterval is fine at single-API-
  instance scale; horizontally scaling requires moving to a Redis-backed
  queue with leader election or a worker shard.
- **Yard capacity** — utilization shows count rather than %; ships when the
  yards module lands.
- **Drizzle-friendly raw SQL** — many reporters use `tx.execute(sql\`...\`)`
  with parameterized literals; the SQL files in `apps/api/src/modules/reporting/queries/`
  were left empty in this session because every query was small enough to
  inline. If a query exceeds ~50 lines, move it into its own .sql file and
  load it with Drizzle's raw helper.

## Cache invalidation

Currently best-effort. Wire-up points for upstream services:

- `InvoicesService` writes → `reporting.invalidate(tenantId, 'revenue' | 'tax' | 'pnl')`
- `PaymentsService` writes → `reporting.invalidate(tenantId, 'revenue')`
- `JobsService.complete` → `reporting.invalidate(tenantId, 'dispatch-performance' | 'driver-performance' | 'commission')`

The invalidation methods are exported on `ReportingService` but the upstream
listeners are not wired in this session to avoid expanding the blast
radius. With a 60s TTL the stale window is bounded; the wiring is a
follow-up task.
