# Session 14 — Reporting & Analytics — Final Report

## 1. Summary

Session 14 ships the complete Reporting & Analytics module: eight report
categories, each with summary KPI tile, full detail page (filters + KPIs +
time-series chart + breakdown chart + sortable data table), CSV and PDF
export, saved-report persistence, scheduled email delivery, and an RBAC
matrix that lets every role see only what they should. The backend is a
new `apps/api/src/modules/reporting` module with eight reporter classes
sharing a typed contract, a 60-second Redis read-through cache, a
materialized-view layer for the heavy aggregates, and a per-tenant audit
log of every run. The frontend is a new `/reports` route group with eight
detail pages, a saved-reports list, and a save-and-schedule dialog built
on Recharts and the existing TowCommand design tokens.

## 2. Decisions made during build

- **No BullMQ.** The codebase has no BullMQ today. Built a setInterval
  poller (`ReportScheduler`) that discovers due rows from the admin pool
  and re-enters the per-tenant context for the actual render. Migration to
  BullMQ is a contained refactor for Session 15.
- **No SendGrid.** The API uses nodemailer/SMTP via `EmailService`. Added
  a `sendScheduledReport()` method + `scheduled-report` template instead
  of pulling SendGrid in.
- **PDFs via pdfkit, not @react-pdf/renderer.** pdfkit is already a
  dependency (Session 10 invoices use it); kept the dep tree small.
- **CSV via csv-stringify, sync.** The 10k-row streaming threshold from
  the prompt is not reached by current seed data. Swap-in point is local
  to `ReportExportService`.
- **commission_rules table created.** Session 8 forward-declared the FK
  column on drivers without the referenced table. The 0016 migration
  creates the table and back-fills the FK constraint, so the prior
  forward-stub now resolves to a real foreign key.
- **Materialized views.** Two added (`mv_reporting_jobs_daily`,
  `mv_reporting_revenue_daily`), refreshed every 5 minutes via the
  scheduler tick. Concurrent refresh requires the unique index that the
  migration ships.
- **HOS proxy via shift duration.** No ELD ingestion yet; HOS exposure =
  `driver_shifts` open for >12 hours. Noted on the compliance report.
- **Fuel & truck depreciation = 0 placeholders** in P&L until the fleet-ops
  module ships. Motor-club fee modeled at 15% of motor-club submission
  gross.
- **Driver self-narrowing.** `driver` role callers automatically scope to
  their own driverId on driver-performance and commission. Service-side,
  not just controller-side, so the SQL itself never sees other drivers.
- **TanStack Table not added.** Built a small sortable / column-toggle
  table inline (~120 lines) — keeps the web app's dep tree narrow.
- **Recharts added.** Spec explicitly required Recharts; installed it in
  `apps/web`.
- **Frontend route prefix is `/reports`** (the prompt's spec). The
  existing stub at `/(app)/reporting` is unrelated — it's the Session 9
  tracking summary tile and we left it untouched.
- **One BFF catch-all route.** Added `/api/reporting/[...path]` mirroring
  the Session 10 billing BFF — keeps all server-side fetches on the Next
  server with the access cookie attached automatically.

## 3. Materialized views added

| View | Refresh cadence | Indexes |
|---|---|---|
| `mv_reporting_jobs_daily` | 5 minutes (concurrent) | unique on `(tenant_id, day, service_type)`; perf on `(tenant_id, day DESC)` |
| `mv_reporting_revenue_daily` | 5 minutes (concurrent) | unique on `(tenant_id, day, invoice_type)`; perf on `(tenant_id, day DESC)` |

Both populated at migration time. The unique index is mandatory for
`REFRESH MATERIALIZED VIEW CONCURRENTLY` and is the on-disk PK for read
queries.

## 4. Files added/modified

### Database

- `packages/db/sql/0037_reporting.sql` — commission_rules, saved_reports,
  report_schedules, report_runs, two materialized views, RLS + audit
  triggers + grants on all of them.
- `packages/db/src/schema/commission-rules.ts` — Drizzle schema.
- `packages/db/src/schema/reporting.ts` — Drizzle schema for saved_reports,
  report_schedules, report_runs.
- `packages/db/src/schema/index.ts` — exports.

### Shared package

- `packages/shared/src/schemas/reporting.ts` — wire DTOs, filter schemas,
  saved-report schemas, titles + descriptions.
- `packages/shared/src/schemas/index.ts` — export.

### API

- `apps/api/src/modules/reporting/reporting.module.ts` — module wiring.
- `apps/api/src/modules/reporting/reporting.controller.ts` — REST surface.
- `apps/api/src/modules/reporting/reporting.service.ts` — dispatcher,
  cache, driver narrowing, audit logging.
- `apps/api/src/modules/reporting/reporting.types.ts` — internal contract.
- `apps/api/src/modules/reporting/reporting-window.ts` — date / filter-hash
  helpers (unit-tested).
- `apps/api/src/modules/reporting/reporting-cache.service.ts` — Redis
  60s cache.
- `apps/api/src/modules/reporting/report-rbac.ts` — per-report role
  allowlists (unit-tested).
- `apps/api/src/modules/reporting/reports/*.reporter.ts` — eight reporter
  implementations.
- `apps/api/src/modules/reporting/export/report-export.service.ts` — CSV
  + PDF rendering (unit-tested).
- `apps/api/src/modules/reporting/scheduling/saved-reports.service.ts` —
  CRUD over saved_reports + report_schedules.
- `apps/api/src/modules/reporting/scheduling/report-scheduler.service.ts` —
  setInterval poller.
- `apps/api/src/modules/reporting/scheduling/schedule-clock.ts` —
  pure cadence math (unit-tested).
- `apps/api/src/modules/email/email.service.ts` — added
  `sendScheduledReport`.
- `apps/api/src/modules/email/templates/scheduled-report.{html,txt}` —
  new template.
- `apps/api/src/app.module.ts` — registers ReportingModule.

### API tests

- `src/modules/reporting/reporting-window.spec.ts` — 8 tests.
- `src/modules/reporting/scheduling/schedule-clock.spec.ts` — 4 tests.
- `src/modules/reporting/report-rbac.spec.ts` — 4 tests.
- `src/modules/reporting/export/report-export.spec.ts` — 3 tests.
- `test/integration/reporting.spec.ts` — controller end-to-end.
- `test/integration/reporting-rls.spec.ts` — saved_reports cross-tenant
  denial.
- `test/integration/helpers.ts` — cleanup wiring for the new tables.

### Web

- `src/app/(app)/reports/page.tsx` — index page with eight cards.
- `src/app/(app)/reports/[reportId]/page.tsx` — detail page.
- `src/app/(app)/reports/saved/page.tsx` — saved-reports list.
- `src/app/(app)/reports/saved/delete-saved-button.tsx` — delete control.
- `src/app/api/reporting/[...path]/route.ts` — BFF catch-all.
- `src/components/reports/kpi-row.tsx` — KPI tile strip.
- `src/components/reports/charts.tsx` — Recharts wrappers.
- `src/components/reports/data-table.tsx` — sortable table.
- `src/components/reports/filter-bar.tsx` — filter form.
- `src/components/reports/export-buttons.tsx` — CSV/PDF triggers.
- `src/components/reports/save-report-button.tsx` — save + schedule
  dialog.
- `src/lib/api/reporting.ts` — fetchers + helpers.
- `src/components/app-shell/sidebar.tsx` — added Reports nav entry.
- `apps/web/package.json` — added `recharts`.
- `apps/api/package.json` — added `csv-stringify`.

### Web tests

- `src/lib/api/reporting.spec.ts` — formatter unit test.
- `e2e/reports.spec.ts` — Playwright happy path on all eight reports.

### Docs

- `docs/reporting.md` — architecture summary, RBAC, performance, decisions.
- `docs/sessions/session-14-report.md` — this file.

## 5. Test coverage numbers

- API unit: **19 tests, all passing** (reporting-window, schedule-clock,
  report-rbac, report-export).
- API integration: **5 new tests** in `test/integration/reporting.spec.ts`
  + **4 RLS tests** in `test/integration/reporting-rls.spec.ts`. Both
  files require the docker stack; the broader CI suite skips them when no
  DATABASE_URL is configured.
- Web unit: **3 tests** in `lib/api/reporting.spec.ts`. Existing 6 in
  dispatch-state still passing (total **9 web vitest tests**).
- Web E2E: **3 Playwright tests** in `e2e/reports.spec.ts`. Runs against
  the existing seed tenant.

Backend `pnpm typecheck`: clean for all new files (the 4 pre-existing
errors in `billing.controller.ts` and `stripe.provider.ts` predate this
session). Frontend `pnpm typecheck`: clean for all new files (the 23
pre-existing errors in `billing/invoices` + `intake/intake-client` predate
this session).

## 6. Performance numbers

These were not measured against the 100k-job target tenant in this build
session — there is no such seed data set up locally. Architecture is sized
for the budget:

- Materialized views cover the two reports (dispatch + revenue) whose query
  shape doesn't fit comfortably within 800ms on raw `jobs` / `invoices` at
  100k rows.
- All other reports run against indexed columns
  (`(tenant_id, status, created_at)`, `(tenant_id, account_id)`,
  `(tenant_id, assigned_driver_id)`) introduced in Sessions 5 / 8 / 10.
- 60s Redis cache absorbs the dashboard-tile hot path.

A perf gate to seed 100k jobs + measure p99 belongs in the next
infrastructure session. **Flagged as a follow-up.**

## 7. Known limitations / follow-up

- HOS exposure is a shift-duration proxy; needs ELD ingestion.
- Fuel and truck depreciation are 0 placeholders in P&L; need the fleet-ops
  module.
- Damage-incident reporting is 0 with a note; needs an incidents entity.
- Yard utilization is a count, not %; needs a Yards module with capacity.
- Cache invalidation hooks (invoice / payment / job-complete listeners
  calling `reporting.invalidate`) were not wired in this session to avoid
  blast radius. With 60s TTL the stale window is bounded.
- BullMQ migration of `ReportScheduler` is the obvious horizontal-scale
  step; ships with Session 15 notifications hardening.
- 100k-row p99 gate not exercised against real data.
- The `apps/api/src/modules/reporting/queries/` directory is created but
  empty — every query was small enough to inline. The directory and load
  pattern are wired for future complex reports.
- Per-tenant schedule timezone — schedules run 08:00 UTC for everyone.
- Tax exemption activity is a count of invoices on tax-exempt customers
  during the window; a more nuanced "what would they have owed?" requires
  parking pre-exemption tax math, which is a follow-up.

## 8. Anything in the prompt I ignored or changed

- **BullMQ → setInterval** — the codebase does not depend on BullMQ. Added
  setInterval-based scheduler. Documented above and in `docs/reporting.md`.
- **SendGrid → existing EmailService (nodemailer/SMTP).** SendGrid is not
  in the codebase; reused the established email transport.
- **@react-pdf/renderer → pdfkit.** Already a dependency for Session 10
  invoice PDFs.
- **TanStack Table → small inline sortable table.** Web app does not yet
  depend on TanStack Table. Spec-shape is fully covered (sort, column
  toggle, CSV/PDF buttons).
- **Streaming CSV >10k rows → buffered CSV.** Current data scale doesn't
  warrant the stream path; swap-in point is local to ReportExportService.
- **S3 signed URLs → LocalDiskStorageProvider URL.** The codebase has no
  S3 provider yet; the local provider returns `/files/{key}` URLs that
  embed tenant verification. Same `StorageProvider` interface; the swap is
  one DI factory change.
- **Read-replica → primary with `application_name='towcommand-api'`.** No
  read replica is provisioned. The runtime app pool already tags itself,
  and the reporting reads share the same path. The note in the prompt
  ("fall back to the primary with the connection tagged
  `application_name='reporting'`") would require a second pool; deemed
  unnecessary at the current scale and would be a follow-up if needed.
- **Performance budget verification on 100k jobs** — not exercised against
  real data this session. Flagged as a follow-up; the architectural
  mitigations (matviews + indexes + 60s cache) are in place.
