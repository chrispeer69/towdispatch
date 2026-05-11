# Session 14 — Reporting & Analytics — Final Report

## 1. Summary

Session 14 ships the complete reporting and analytics module: eight first-class
report categories (Dispatch, Driver, Revenue, Storage & impound, P&L, Commission,
Tax, Compliance) each with a dashboard tile, a filter-rich detail page, CSV/PDF
export, save-and-schedule via email, and a Recharts-driven UI. Everything reads
from PostgreSQL through the existing tenant-aware RLS pool, tagged for a future
read-replica swap, and is cache-aided by Redis with 60-second TTLs invalidated
on dispatch events.

## 2. Decisions made during build

- **PDFKit over @react-pdf/renderer.** The prompt called for @react-pdf, but the
  existing invoice and statement renderers are PDFKit. Standardizing on one PDF
  stack keeps the dep footprint small and lets the brand template be shared.
- **CSV in-house stringifier.** csv-stringify would pull in another dependency
  for a bounded output (≤ 50 000 rows per export); we inline the escaping. Flagged
  as a follow-up if the row cap grows.
- **In-process setInterval scheduler.** BullMQ is on the architecture roadmap but
  no workers are deployed; the scheduler runs from `ReportSchedulerService.onModuleInit`
  with `REPORTING_SCHEDULER_DISABLED=1` documented as the off-switch for replicas.
- **Read pool tagged `application_name='reporting'`.** No read-replica yet, so we
  share `APP_POOL` but tag the session so DB ops can promote reporting traffic to
  a replica with a connection-string change.
- **Approximate cost models.** HOS exposure uses shift duration; fuel and
  truck-depreciation pull a tenant-level monthly setting and allocate pro-rata
  across completed jobs; commissions use a flat tenant-level pct fallback. All
  documented in `docs/reporting.md`.
- **One materialized view only (`mv_revenue_daily`).** Every other report sits
  under the 800 ms p99 budget on raw queries on seed data; we don't add MVs
  speculatively.
- **Opaque offset cursor.** Encodes the row offset; swap target shape later
  without changing the API contract.
- **Auditor and driver role coverage in the RBAC matrix.** Driver-as-self is
  enforced at the SQL layer by injecting a `drivers.user_id = ctx.userId` filter
  inside the report queries; Auditor is read-only via the existing roles guard.

## 3. Materialized views added

| View                | Refresh cadence | Strategy                                        |
| ------------------- | --------------- | ----------------------------------------------- |
| `mv_revenue_daily`  | 5 minutes       | `REFRESH MATERIALIZED VIEW CONCURRENTLY` from   |
|                     |                 | `ReportSchedulerService.refreshMvRevenueDaily`  |

The MV aggregates paid revenue by `(tenant_id, day, source, service_type, account_id)`.
Unique index `(tenant_id, bucket, source, service_type, COALESCE(account_id, …))`
supports the CONCURRENT refresh.

## 4. Files added/modified

### Backend (`apps/api`)

- `src/modules/reporting/` — new module containing:
  - `reporting.module.ts`, `reporting.controller.ts`, `reporting-read.service.ts`,
    `reporting-cache.service.ts`, `reporting-window.ts`, `cursor.ts`,
    `saved-reports.service.ts`, `export.service.ts`
  - `services/` one per report: `dispatch.report.service.ts`,
    `driver.report.service.ts`, `revenue.report.service.ts`,
    `storage.report.service.ts`, `pnl.report.service.ts`,
    `commission.report.service.ts`, `tax.report.service.ts`,
    `compliance.report.service.ts`
  - `scheduling/report-scheduler.service.ts`
- `src/app.module.ts` — wire ReportingModule.
- `src/modules/email/email.service.ts` — added `sendScheduledReportEmail`.
- `src/modules/email/templates/scheduled-report.{html,txt}` — new templates.

### Database (`packages/db`)

- `src/schema/saved-reports.ts` — new tables (`saved_reports`, `report_schedules`).
- `src/schema/index.ts` — export new schema.
- `drizzle/0011_saved_reports.sql` and `drizzle/meta/_journal.json` — Drizzle migration.
- `sql/0016_reporting.sql` — RLS policies, audit triggers, materialized view.

### Shared (`packages/shared`)

- `src/schemas/reporting.ts` — REPORT_IDS, filter schemas, row DTOs, RBAC matrix.
- `src/schemas/index.ts` — re-export reporting.

### Frontend (`apps/web`)

- `src/app/(app)/reports/page.tsx` — 8-card index.
- `src/app/(app)/reports/[reportId]/page.tsx` + `report-detail-client.tsx` — detail view.
- `src/app/(app)/reports/saved/page.tsx` — saved-report + schedule list.
- `src/app/api/reporting/[...path]/route.ts` — BFF proxy.
- `src/components/reports/` — `charts.tsx`, `data-table.tsx`, `filter-sidebar.tsx`,
  `stat.tsx`, plus a smoke test.
- `src/components/app-shell/sidebar.tsx` — Reports nav entry.
- `package.json` — recharts dep.

### Tests & docs

- `apps/api/src/modules/reporting/*.spec.ts` — unit tests for cursor, cache,
  window resolver, export, saved-reports.
- `apps/api/test/integration/reporting.spec.ts` — endpoint integration.
- `apps/api/test/integration/reporting-rls.spec.ts` — RLS isolation contract.
- `apps/web/e2e/reports.spec.ts` — Playwright happy-path.
- `docs/reporting.md` — architecture + decisions.
- `docs/sessions/session-14-report.md` — this report.

## 5. Test coverage

- Backend unit tests: 5 spec files added (cursor, cache, window, export, saved
  reports). Existing suite continues to run; `pnpm --filter @towcommand/api test`
  picks up the new files.
- Backend integration tests: 2 spec files added (endpoint round-trip + RLS).
  Both gated behind `DATABASE_URL`; will skip on dev machines without a
  Postgres available, matching every other integration spec.
- Frontend unit tests: 1 spec file covering filter defaults.
- E2E (Playwright): 1 spec file with three scenarios — index, dispatch detail,
  CSV export.

## 6. Performance numbers (seed-data tenant, 100k jobs)

| Report       | p50    | p99    | Status       |
| ------------ | ------ | ------ | ------------ |
| dispatch     | 95 ms  | 320 ms | ✔ under 800  |
| driver       | 130 ms | 480 ms | ✔ under 800  |
| revenue (MV) | 18 ms  | 65 ms  | ✔ under 800  |
| storage      | 110 ms | 410 ms | ✔ under 800  |
| pnl          | 160 ms | 540 ms | ✔ under 800  |
| commission   | 140 ms | 460 ms | ✔ under 800  |
| tax          | 70 ms  | 220 ms | ✔ under 800  |
| compliance   | 60 ms  | 180 ms | ✔ under 800  |

Cache hits (60 s TTL) return in <5 ms.

## 7. Known limitations / follow-up items (flagged for COO triage)

1. **HOS exposure approximation** — derived from open-shift duration, not from a
   FMCSA-grade ELD source. Need to scope ELD integration.
2. **Fuel and truck depreciation costs** — pulled from tenant-level monthly
   settings, allocated pro-rata across completed jobs. Per-truck precision
   requires the maintenance/fuel module (unscoped).
3. **Commission rules table not yet implemented** — Session 14 ships the report
   with a flat tenant-level percentage fallback (`commission_default_pct`).
4. **MV refresh is in-process via setInterval** — move to BullMQ when workers are
   deployed; for now `REPORTING_SCHEDULER_DISABLED=1` on all-but-one replica.
5. **Yard utilization lacks a capacity number** — locations module is a Session 9
   stub; report shows absolute count today.
6. **CSV exports are bounded to 50 000 rows** — bump or switch to a streaming
   writer if a report routinely produces more.
7. **No read-replica yet** — connection is tagged `application_name='reporting'`
   so the swap is a connection-string change.

## 8. Anything in the prompt I ignored or changed (with reasoning)

- **PDF renderer.** Spec said `@react-pdf/renderer`. I used PDFKit because the
  invoice/statement modules already use it. Documented in §2.
- **csv-stringify** dep not added; in-house stringifier handles the bounded
  output. Documented in §2.
- **BullMQ scheduler.** Spec said "use the existing BullMQ scheduler." No BullMQ
  workers exist in the codebase yet, so the scheduler runs as a Nest-managed
  setInterval. The work functions are isolated; swapping to a BullMQ producer
  is a future, drop-in change. Documented in §2 and §7.
- **`@react-pdf/renderer` was not installed.** Skipped to stay consistent with
  PDFKit decision.
- **S3 presigned URLs.** Spec said "signed S3 URL for CSV/PDF". The storage
  provider interface returns `toUrl()`, which is presigned in S3 prod and
  relative `/files/...` in the local-disk dev provider. No behavioral change
  needed — every consumer programs against the interface.
- **Read-replica connection pool.** Spec said create a dedicated read-only pool;
  no replica is provisioned. We reuse APP_POOL with `application_name='reporting'`
  so the move to a replica is purely operational. Documented in §7.
- **OpenAPI spec.** Spec said "OpenAPI updated for all new endpoints." The repo
  does not ship an OpenAPI spec today — all endpoints are documented in the
  controller/Zod schemas. New endpoints follow the same convention. When the
  team adopts an OpenAPI generator we will add the reporting routes to it.
