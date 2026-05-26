# Session 53 — Reporting: Decision Log

## D0 — Spec premise was materially incorrect (the headline decision)

The launch brief assumed "S14 (early) shipped a basic reports page" and instructed
an additive build. **Reality on `origin/master` @ `13439ba`:** Session 14 already
shipped a full Reporting & Analytics module (migration `0037_reporting.sql`):

- Tables `saved_reports`, `report_schedules`, `report_runs`, `commission_rules` +
  two materialized views — all FORCE RLS, audit-triggered, soft-deleted.
- A working scheduler (`report-scheduler.service.ts`, 60s `setInterval`, gated by
  `REPORT_SCHEDULER_DISABLED`) with CSV/PDF export + per-recipient email fan-out.
- 9 canned reporters: `dispatch-performance`, `driver-performance`, `revenue`,
  `storage`, `pnl`, `commission`, `tax`, `compliance`, `ev-recovery`.
- Saved-report CRUD, per-report RBAC, a 60s Redis cache, web `/reports` pages.
- A/R aging already exists in the `ar` module (`ar-reports.service.ts` →
  `aging_summary` with current/1-30/31-60/61-90/91+ buckets).

The **pre-flight gate** (`ls apps/api/src/modules | grep reporting`) matched. The
gate's purpose is to prevent rebuilding shipped work; CLAUDE.md Rule 1 + the
operating rules ("never stop, pick the conservative path, document, continue")
preclude an abort-to-nothing.

**Decision: pivot from "build the reporting module" to "fill the genuine gaps."**
The net-new Session 53 surface is:

1. **Custom Report Builder** — entity registry + allowlist field exposure +
   parameterized query compiler over arbitrary base entities. The existing
   `saved_reports` only persists *filters* against the 9 fixed reporter IDs; it is
   NOT a self-serve field-level builder. **This is the headline deliverable.**
2. **KPI Dashboard** — `kpi_widget_catalog` + per-user `kpi_dashboard_layouts` +
   per-widget compute functions. Nothing existed.
3. **P&L per-account / per-motor-club** — the existing `pnl` reporter rolls up by
   truck; account / motor-club P&L added as two new reporter IDs.
4. **Aging drill-down** — bucket math already exists in `ar`; added the per-account
   open-invoice drill-down that did not.

**Did NOT** create duplicate `report_schedules` / `report_runs` tables (the exact
catastrophe the gate guards against). See D2.

## D1 — `report_templates` is net-new; distinct from `saved_reports`

`saved_reports` = saved filter values keyed to one of 9 fixed `report_id` strings.
`report_templates` = a base entity + a chosen field list + filters + group-by +
sort, compiled to SQL at run time. Different concept, different table. Named
`report_templates` per the brief.

## D2 — Separate scheduling lane for builder templates (NOT extending `report_schedules`)

The 0037 `report_schedules` has `saved_report_id NOT NULL`, a unique index on it,
and a `format CHECK IN ('csv','pdf')`. Forking it for templates (nullable FK +
relaxed CHECK + dual-mode scheduler) is more invasive than a clean separate lane
and risks regressing the in-production 0037 scheduler. **Decision:** new
`report_template_schedules` + `report_template_runs`, mirroring 0037 conventions
exactly. The 0037 scheduler and the new builder scheduler coexist, each scanning
its own table.

## D3 — Result-set cap = 50,000 rows (per brief)

`executeReport` caps at 50,000 rows. Over-cap interactive requests return the first
page with `truncated: true`; the UI directs the operator to schedule an async run
that emails a download link. Kept the brief's 50k.

## D4 — Export libraries: reuse existing, defer XLSX

The 0037 `ReportExportService` standardized on `csv-stringify/sync` + `pdfkit`
(NOT Papa.unparse / SheetJS as the brief assumed). Per CLAUDE.md Rule 4 (no new
deps unless required), the builder reuses that service for CSV + PDF. **XLSX is
deferred 🟡** — adding SheetJS is a new dependency for a third export format that
CSV already covers for BI ingest. Documented rather than shipped. The
`report_template_schedules.format` CHECK therefore allows `csv|pdf` only this
session (not `xlsx`); widening it is a one-line follow-up migration when SheetJS is
adopted.

## D5 — COGS columns absent on master → revenue-only P&L with explicit note

`jobs` carries only `rate_quoted_cents`. There are **no** `driver_pay_amount`,
`fuel_cost`, or `tolls_amount` columns. P&L COGS therefore =
driver commission (via `drivers.commission_rule_id → commission_rules`, matching the
existing `pnl.reporter`) + a motor-club fee proxy (15% on `is_motor_club`
submissions, matching the existing reporter). Fuel / tolls / depreciation emit `$0`
with a "data not available" note. No invented numbers.

- Columns FOUND: `jobs.rate_quoted_cents`, `invoices.{total,paid,balance}_cents`.
- Columns MISSING (defaulted to $0 + note): `driver_pay_amount`, `fuel_cost`,
  `tolls_amount`, truck depreciation.

## D6 — Drivers/trucks read path

There is no separate `drivers_view`. The existing reporters read `drivers` /
`trucks` directly inside the per-tenant RLS transaction (read-only, LEFT JOIN). The
builder's entity registry mirrors that: `assigned_driver_id` / `assigned_truck_id`
resolve to `drivers.name` / `trucks.unit_number` via read-only joins. No writes to
Fleet-owned tables. Chosen because `drivers_view` does not exist on master and the
direct-read RLS pattern is already the established, audited path.

## D7 — Entity registry contents (allowlist — what's exposed)

Base entities exposed (only those whose tables are on master):
`jobs`, `invoices`, `accounts`, `impound` (`impound_records`), `lien_cases`.

`repo` from the brief is **excluded** — there is no repossession module on master;
the registry cannot list an entity that does not exist.

Every queryable field and every joinable relation is enumerated in the registry.
Any field not in the registry is rejected at compile time (`400`). There is **no**
`select *` path and **no** raw-SQL / SQL-editor surface. All filter values bind as
parameters; nothing is string-concatenated.

## D8 — Scheduler cadence storage = enum (not cron string)

`report_template_schedules.cadence` is an enum (`daily|weekly|monthly`) + a local
delivery time + optional day-of-week / day-of-month, reusing the 0037
`schedule-clock.ts` `computeNextRun` helper. Chosen for tenant-facing UX simplicity
(operators pick "weekly on Monday 6am", not a cron expression). Cron-string support
is a future widening if a tenant needs sub-daily cadence.

## D9 — KPI widget catalog: seeded only where the data source is on master

Seeded widgets (source confirmed on master): `jobs_today`, `revenue_mtd`,
`revenue_ytd`, `goa_rate_7d`, `avg_eta_7d`, `open_impound_count`, `lien_due_30d`
(lien-processing on master), `accounts_aging_total`, `top_5_accounts_revenue_mtd`,
`top_5_motor_clubs_revenue_mtd`, `driver_count_active`, `truck_count_active`.

All 12 brief widgets have their source tables on master, so all 12 are seeded. Any
widget whose compute would 500 for lack of a column degrades to a `null` value tile
with a note rather than erroring.

## D10 — Web: @dnd-kit + recharts + CSS grid (no react-grid-layout)

`apps/web` already depends on `@dnd-kit/core` + `@dnd-kit/sortable` + `recharts`.
There is **no** `react-grid-layout`. Per Rule 4, the builder's field picker and the
KPI dashboard use `@dnd-kit/sortable` for drag-ordering over a CSS grid, and
`recharts` for widget visuals. No new web dependency added.

## D11 — Migration number = 0051

`0050_enterprise_sso.sql` is the highest on master; `0051_reporting_builder.sql` is
next-contiguous. Per the migration-numbering note, kept the launch-contiguous
number; `migrate.ts` re-applies idempotent SQL each run so it is safe.

## D12 — Env gates

- `REPORTING_BUILDER_ENABLED` — default **true** (additive, no breakage). Gates the
  builder + KPI controllers.
- `REPORT_SCHEDULER_CRON_ENABLED` — default **false** (per brief). Gates the new
  builder scheduler's tick. The legacy 0037 scheduler keeps its own
  `REPORT_SCHEDULER_DISABLED` gate untouched.

## Deferred (🟡)

- XLSX export (D4) — needs SheetJS; CSV covers BI ingest meanwhile.
- BullMQ-backed scheduler sharding — both schedulers use `setInterval`, matching the
  existing 0037 deviation note.

## D13 — Repaired a botched merge that left `origin/master` non-compiling

`origin/master` @ `13439ba` did **not** typecheck before this session. PR #129
(SSO, commit `5eaf71e`) was merged with **unresolved conflict markers committed in
six files**:

- `apps/api/src/config/config.schema.ts`
- `apps/api/src/config/config.service.ts`
- `apps/api/src/app.module.ts`
- `packages/db/src/schema/index.ts`
- `packages/shared/src/constants/error-codes.ts`
- `apps/web/src/app/(app)/settings/tabs.ts`

In `config.schema.ts` three env fields were additionally **truncated** to `: z`
(their `.enum().default().transform()` chains were eaten by the conflict):
`AUCTION_LIFECYCLE_CRON_ENABLED`, `FRAUD_SCORE_CRON_ENABLED`,
`DAMAGE_ANALYSIS_WORKER_ENABLED`. In `config.service.ts` the
`marketplaceWebhookDeliveryEnabled` getter lost its closing brace.

All six were repaired by **union resolution** (keep both sides) + restoring the
truncated declarations. This was unavoidable: the branch cannot compile, and the
env-gate work (D12) edits `config.schema.ts` directly.

Fixing the conflict markers then **un-masked two pre-existing duplicate-export
ambiguities** (TS2308) that the broken build had been hiding:

- `RecordOutcomePayload` / `recordOutcomeSchema` — defined in BOTH
  `ai-dispatch/outcomes.ts` (S41) and `fraud-detection/outcomes.ts` (S43).
  Renamed the fraud-detection pair to `RecordDisputeOutcomePayload` /
  `recordDisputeOutcomeSchema` (semantically a dispute outcome) + updated its 3
  consumers (fraud controller/service, web fraud-client). ai-dispatch unchanged.
- `WebhookDeliveryDto` — defined in BOTH `schemas/notifications.ts` (S15) and
  `schemas/public-api.ts` (S29). Renamed the notifications type to
  `NotifyWebhookDeliveryDto` + updated its 3 consumers (notifications
  controller/service, web notifications.server). public-api unchanged.

These are all from prior parallel-session merges, surfaced (not caused) by Session
53. Documented here and called out in the PR body so the reporting diff touching
`app.module.ts` / `error-codes.ts` reads as intentional.

Fixing the markers then revealed further **mangled-merge corruption** (lost `/**`
openers, missing closing braces, two files mashed into one, duplicated import
blocks, stale specs vs changed constructors) repaired to reach a green
`pnpm typecheck`. Complete file tally:

| File | Repair |
|---|---|
| `apps/api/config.schema.ts` | markers + 3 truncated cron fields + 2 lost `/**` |
| `apps/api/config.service.ts` | markers + `jwt` getter dup keys + `backupVerify`/`publicApi`/`portal` getters missing `};}` |
| `apps/api/app.module.ts` | markers (module-list union) |
| `apps/api/modules/auth/jwt.service.ts` | interface chain (`}`+`/**`), `verifyPortal`/`verifyBidder` missing `}`, `PortalAccessClaims.tid` restored |
| `apps/api/modules/admin/admin.controller.ts` | duplicate import block; `ctx()` missing `}` (audit-log + sentry-test union) |
| `apps/api/modules/admin/admin.module.ts` | two `@Module`s mashed → single (keeps `AdminService` provider) |
| `apps/web/sentry.server.config.ts`, `sentry.edge.config.ts` | two versions mashed → R-06 `SENTRY_DSN_WEB` |
| `apps/web/src/lib/api/marketplace-client.ts` | two clients mashed → both preserved, `call` completed |
| `apps/web/components/app-shell/sidebar.tsx` | Lien/DOT nav items collapsed into one object (dup keys) → split |
| `packages/shared/error-codes.ts`, `schemas/notifications.ts`, `fraud-detection/outcomes.ts` | markers + dup-export renames |
| `packages/db/schema/index.ts`, `schema/notifications.ts` | markers + `webhookDeliveries`→`notificationWebhookDeliveries` |
| stale specs | `admin.controller.spec`, `health-metrics.controller.spec` (4th region arg + `toEqual`), `test/customer-portal-service.spec` (TenantAwareDb 3-arg) |

## D14 — Unfixed pre-existing risk: two physical `webhook_deliveries` tables

`0037_public_api.sql` and `0038_notifications.sql` BOTH `CREATE TABLE webhook_deliveries`
with different column sets. The drizzle-side const collision was renamed (D13), but
the **SQL-level overlap is a genuine runtime conflict** for any environment that runs
both migrations against one database. NOT fixed this session — flagged for a dedicated
follow-up (it touches two unrelated modules' data models and is out of reporting scope).

## D15 — Web scope: BFF reused, two pages shipped, rest deferred

- **BFF needs no new code.** The existing `/api/reporting/[...path]` catch-all proxies
  every method to API `/reporting/*`; all new endpoints (`/reporting/builder/*`,
  `/reporting/kpi/*`, `/reporting/pnl/*`, `/reporting/aging`) ride it as-is.
- **Shipped:** typed server-fetcher client (`lib/api/reporting-builder.ts`), the KPI
  dashboard (`/reports/kpi`, server-rendered tiles from the saved/default layout), and
  the template library (`/reports/builder`).
- **English-only** strings, matching the Session 14 reporting surface (no next-intl
  there yet) with `TODO(i18n)` markers — consistent with `/settings` per Rule 9.
- **Deferred 🟡** (backend complete + reachable via BFF; UI is follow-up): the visual
  drag-drop field-picker editor, the per-user KPI grid editor (`/kpi/edit`), the run
  viewer (`/runs/:id`), and the dedicated `/reports/pnl` + `/reports/aging` pages, plus
  the web snapshot tests. The API is fully unit + integration tested.
