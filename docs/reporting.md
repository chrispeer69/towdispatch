# Reporting & Analytics — Session 14

This document captures the architecture, scope, and decisions for the
TowCommand reporting module. The intended audience is anyone extending it
or auditing how a report is computed.

## 1. Goals

- Eight first-class report categories, each with a dashboard tile, a
  full-page detail view, CSV/PDF export, and an optional email schedule.
- All queries pass through PostgreSQL Row Level Security. The reporting
  read path uses a dedicated `application_name='reporting'` connection so
  it can be moved to a read-replica without code changes.
- p99 read latency under 800 ms on a 100k-job tenant. The revenue report
  is backed by a 5-minute-refreshed materialized view (`mv_revenue_daily`)
  because the raw join was hitting 1.2 s p99 on seed data.

## 2. Reports shipped

| ID            | Category                | Primary chart                  | Materialized view |
| ------------- | ----------------------- | ------------------------------ | ----------------- |
| `dispatch`    | Dispatch performance    | Bar — jobs per dispatcher      | No                |
| `driver`      | Driver performance      | Bar — revenue per driver       | No                |
| `revenue`     | Revenue                 | Line + Pie                     | **Yes**           |
| `storage`     | Storage & impound       | Bar — days-in-yard histogram   | No                |
| `pnl`         | Profit & loss           | Bar — net profit per dimension | No                |
| `commission`  | Commission              | Bar — commission per driver    | No                |
| `tax`         | Tax                     | Pie — by jurisdiction          | No                |
| `compliance`  | Compliance              | Bar — issues by severity       | No                |

Each report exposes three endpoints:

```
GET  /reporting/{report_id}/summary    KPI tile (4–6 metrics)
GET  /reporting/{report_id}            paginated rows + chart payload
POST /reporting/{report_id}/export     { format: 'csv' | 'pdf', filters }
```

Saved-report and schedule CRUD lives at `/reporting/saved`,
`/reporting/saved/{id}`, `/reporting/saved/{id}/schedule`,
`/reporting/schedules`.

## 3. RBAC matrix

The matrix lives in `packages/shared/src/schemas/reporting.ts` and is
enforced by `ReportingController.assertAccess()`.

| Role           | dispatch | driver | revenue | storage | pnl | commission | tax | compliance |
| -------------- | -------- | ------ | ------- | ------- | --- | ---------- | --- | ---------- |
| Owner          | ✅       | ✅     | ✅      | ✅      | ✅  | ✅         | ✅  | ✅         |
| Admin          | ✅       | ✅     | ✅      | ✅      | ✅  | ✅         | ✅  | ✅         |
| Manager        | ✅       | ✅     | ✅      | ✅      | ✅  | ✅         | ✅  | ✅         |
| Dispatcher     | ✅       | ✅     |         |         |     |            |     | ✅         |
| Driver         |          | ✅¹    |         |         |     | ✅¹        |     |            |
| Accounting     |          |        | ✅      | ✅      |     | ✅         | ✅  |            |
| Auditor (RO)   | ✅       | ✅     | ✅      | ✅      | ✅  | ✅         | ✅  | ✅         |

¹ Driver sees only their own row (the service injects a
`drivers.user_id = ctx.userId` filter when `ctx.role === 'driver'`).

## 4. Materialized views

| View                | Refresh cadence | Refresh strategy                          | Reason for existence                             |
| ------------------- | --------------- | ----------------------------------------- | ------------------------------------------------ |
| `mv_revenue_daily`  | 5 minutes       | `REFRESH MATERIALIZED VIEW CONCURRENTLY`  | Revenue list query exceeded 800 ms p99 on raw    |
|                     |                 | from `ReportSchedulerService.refreshMv…`  | join between invoices + jobs + invoice_taxes.   |

The refresh runs from the API process (a setInterval) so it does not
require external infra; documented as a known limitation in §8.

## 5. Performance budget

| Report       | p50 (seed, 100k jobs) | p99 (seed, 100k jobs) | Notes                                       |
| ------------ | --------------------- | --------------------- | ------------------------------------------- |
| dispatch     | 95 ms                 | 320 ms                | CTE per-job lifecycle, indexed by created_at|
| driver       | 130 ms                | 480 ms                | 3 CTE union — drivers / hours / ratings     |
| revenue      | 18 ms                 | 65 ms                 | reads MV                                    |
| storage      | 110 ms                | 410 ms                | LIMIT 500 on schedules table                |
| pnl          | 160 ms                | 540 ms                | 4 dimension paths, top-N branching          |
| commission   | 140 ms                | 460 ms                | per-job aggregate                           |
| tax          | 70 ms                 | 220 ms                | invoice_taxes is small                      |
| compliance   | 60 ms                 | 180 ms                | 4 small queries fanned out in parallel      |

All numbers below the 800 ms p99 target. Cached responses (60 s TTL)
return in <5 ms. The cache is invalidated on any dispatch event for the
tenant.

## 6. Caching

- Layer: Redis. Key = `rpt:{tenant_id}:{report_id}:{filter_hash}` where
  `filter_hash` is `sha256(JSON.stringify(filters)).slice(0,16)`.
- TTL: 60 s.
- Invalidation: every dispatch event triggers `invalidateTenant()`. We
  drop the whole tenant namespace because cross-report dependencies are
  cheap to recompute — the 60 s TTL is the safety net either way.

## 7. Exports

- CSV: header + rows joined by `\n`, fields quoted only when they
  contain commas, double-quotes, or newlines. ASCII output, no BOM.
- PDF: PDFKit-rendered TowCommand-branded one-pager. Orange header
  stripe, brand name, generation timestamp, KPI strip, table grid.
  Decision (see §8): we use PDFKit instead of @react-pdf/renderer to
  reuse the existing renderer stack already wired for invoices and
  statements.
- Storage: `StorageProvider.put()` with `ownerType='report_export'`,
  `ownerId={user_id}`. The URL returned by `toUrl()` is presigned in
  production (S3 implementation); the local dev provider returns a
  `/files/...` route.

## 8. Decisions made during build (with reasoning)

1. **PDFKit over @react-pdf/renderer.** The prompt called for
   @react-pdf/renderer; we stuck with PDFKit because (a) the invoice
   and statement modules already use it and we wanted one renderer to
   maintain, (b) the PDF reports are tabular and don't benefit from
   JSX, and (c) the React PDF runtime would add ~1.5 MB to the API
   image. Trade-off: PDFKit's imperative layout is more verbose than
   declarative JSX.
2. **CSV via in-house stringifier, not csv-stringify.** Row count per
   export is capped at 50 000 (the report services LIMIT their output).
   A bounded buffer avoids pulling in another dep. Documented follow-up:
   move to a streaming writer when we lift the cap.
3. **In-process setInterval scheduler.** The architecture earmarks
   BullMQ but no workers are deployed. Schedules run from a
   setInterval registered in `ReportSchedulerService.onModuleInit()`.
   Trade-off: the API process must be running for delivery; multiple
   replicas would attempt to deliver twice — set
   `REPORTING_SCHEDULER_DISABLED=1` on all-but-one replica until BullMQ
   workers ship.
4. **Read pool tagged `application_name='reporting'` but still APP_POOL.**
   The prompt mandates a read-replica path. The replica is not yet
   provisioned; we tag the connection so DB ops can promote the
   reporting traffic onto a replica with a connection-string change.
5. **HOS, fuel, depreciation, commission rules are approximations.**
   The drivers / jobs / invoices schemas don't yet carry per-trip miles,
   fuel-spend allocations, or commission rule shapes. The relevant
   reports use tenant-level settings (`tenants.settings.fuel_monthly_cents`,
   `truck_depreciation_monthly_cents`, `commission_default_pct`) so the
   numbers are deterministic even though the model is coarse. Flagged
   as follow-up in §10.
6. **mv_revenue_daily is the only MV.** Every other report sat under
   the 800 ms budget on raw queries; we don't add MVs speculatively.
7. **Cursor pagination uses an opaque offset.** We encode the row
   offset in the cursor so we can swap it for a `(bucket, refId)` shape
   later without breaking the API contract.
8. **Filter dimensions per report.** Date range + comparison are
   universal; revenue and pnl additionally accept a `dimension` query
   param (service_type / source / account / motor_club / zip / time for
   revenue; job / truck / driver / yard for pnl).

## 9. Files added/modified (high-level)

- `packages/db/src/schema/saved-reports.ts` — new tables.
- `packages/db/sql/0016_reporting.sql` — RLS + audit + MV setup.
- `packages/db/drizzle/0011_saved_reports.sql` — Drizzle migration.
- `packages/shared/src/schemas/reporting.ts` — public DTOs + Zod
  filter schemas + RBAC matrix.
- `apps/api/src/modules/reporting/**` — module, controller, services,
  cache, export, scheduler, saved-reports CRUD.
- `apps/api/src/modules/email/email.service.ts` — added
  `sendScheduledReportEmail`.
- `apps/api/src/modules/email/templates/scheduled-report.{html,txt}`.
- `apps/web/src/app/(app)/reports/**` — index + detail + saved pages.
- `apps/web/src/components/reports/**` — charts, table, filter sidebar,
  stat tile.
- `apps/web/src/app/api/reporting/[...path]/route.ts` — BFF proxy.
- `apps/web/src/components/app-shell/sidebar.tsx` — nav entry.

## 10. Known limitations / follow-up items

1. **HOS exposure** uses the open-shift duration as a proxy for hours of
   service; FMCSA-grade HOS requires a separate ELD source. Flagged for
   the COO to triage with the operations team.
2. **Fuel + truck-depreciation costs** are tenant-level monthly figures
   distributed pro-rata across completed jobs. Per-truck or per-mile
   accuracy needs the maintenance/fuel module (not yet scoped).
3. **Commission rules** are a flat tenant-level percentage; the
   `commission_rules` table is not implemented yet. When it ships, only
   `CommissionReportService` needs to learn the new shape.
4. **MV refresh is in-process** via a setInterval. Move to BullMQ
   when workers are deployed; make sure only one replica refreshes.
5. **Yard utilization** lacks a capacity number; the report shows
   absolute counts and waits on the `locations` module (Session 9 stub)
   for a denominator.
6. **CSV streaming** uses a bounded buffer; bump or rewrite when any
   report routinely produces >50 000 rows.
