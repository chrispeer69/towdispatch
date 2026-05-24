# Session 54 — Yard Management

## TL;DR

Shipped the operator-facing yard floor as an **additive** layer over Session 22
impound: multi-facility config, a visual stall map with photos, per-facility /
per-vehicle-class **storage rate cards**, a daily **auto-billing** engine +
run log, a gated 4-step **release workflow**, and a **gate-search** booth
lookup. New migration `0051_yard_management.sql` (7 tables, FORCE RLS + audit +
cross-tenant FK guards), 7 Drizzle schemas, shared Zod contracts under
`packages/shared/src/yard/`, a full Nest module (`apps/api/src/modules/yard/`)
with env gates, six web pages, and 45 passing pure unit tests + DB-gated RLS &
integration specs.

**Prerequisite:** the branch base did not compile — committed merge corruption
across ~15 files (conflict markers, eaten braces, three-way file
concatenations) that the un-CI-gated API package never caught. Repaired in a
dedicated first commit so this work is verifiable. Full detail in
`SESSION_54_DECISIONS.md` §0.

## Decision log

See `SESSION_54_DECISIONS.md` for the full rationale. Headlines:

- Grid `(x,y)` stall model over a pixel canvas.
- Rate resolution = most-recent-effective-on-date; gaps skip (never charge $0);
  overlapping windows rejected at write.
- Free days = UTC calendar days from storage start, partial = full day.
- `classifyVehicle` first-match heuristic (motorcycle/trailer/rv → heavy →
  light_truck → passenger).
- Release: 4 steps, lienholder optional, gate needs payment OR lienholder auth;
  every step idempotent.
- `storage_charges` is an INDEPENDENT ledger from S22 `impound_fees`; cron
  defaults **off** to avoid double-billing.
- Billing requires a stall assignment (the stall supplies the facility whose
  rate card applies — the bridge between `impound_yards` and `yard_facilities`).

## What shipped ✅

- **DB**: `0051_yard_management.sql` — `yard_facilities`, `yard_stalls`,
  `yard_stall_photos`, `storage_rate_cards`, `storage_billing_runs`,
  `storage_charges`, `release_workflows`. FORCE RLS + `fn_audit_log` triggers +
  cross-tenant consistency triggers on every table; idempotency partial-uniques
  on stall label, single occupant, and `(impound_id, charge_date)`.
- **Drizzle**: 7 schema files registered in the barrel.
- **Shared**: `packages/shared/src/yard/` (facilities, stalls, rate-cards,
  billing, release, gate-search) with DTOs + strict payload schemas + pure
  result types.
- **API** (`apps/api/src/modules/yard/`): `YardFacilityService`,
  `YardStallService` (assign/release/bulk-layout/photos), `GateSearchService`,
  `RateCardService` (overlap validation), `StorageBillingService` +
  `StorageAutoBillingCron`, `ReleaseWorkflowService`; pure logic
  (`validateStallAssignment`, `classifyVehicle`, `resolveRate`,
  `computeDailyStorageCharge`, `evaluateReleaseTransition`); 4 controllers +
  `YardEnabledGuard` + `YardModule`; wired into `app.module.ts`.
- **Env gates**: `YARD_MANAGEMENT_ENABLED` (default true, additive),
  `STORAGE_AUTOBILLING_CRON_ENABLED` (default false).
- **Web** (`apps/web/src/app/(app)/yard/`): `/facilities` (CRUD),
  `/facilities/[id]/map` (grid + drag-drop layout + assign + photos),
  `/facilities/[id]/rate-cards`, `/gate-search`, `/release/[impoundId]`
  (status-driven wizard), `/billing/runs` (+ run-now). BFF proxy at
  `/api/yard/[...path]`, browser client `lib/api/yard-client.ts`, sidebar nav
  entry.
- **Tests**: 45 pure unit tests (stall assignment, classify, resolveRate,
  overlap, charge math, release state machine) — green. DB-gated `yard-rls`
  (tenant isolation + FK guards + idempotency) and `yard-billing-release`
  (assign → bill → idempotent re-bill → release → no double-charge; +
  cancellation) integration specs.

## Deferred 🟡

- **Storage charges → invoice roll-up at release**: charge ledger ships; actual
  invoice line integration deferred to avoid forking `invoices.service.ts`
  (DO-NOT-touch-core). Clean seam left. (Decisions §6.)
- **GVWR/axle classification signals**: `vehicles` lacks weight/axle; heavy
  classification leans on dispatch class until `hd_job_attributes` is wired.
- **Gate-search case-number**: no case number on `impound_records` (lives in S23
  lien module).
- **Per-step release URLs**: implemented as one status-driven page (retry-safe);
  API steps are already discrete endpoints if per-URL UI is wanted later.
- **`webhook_deliveries` physical-table collision** (pre-existing): only the TS
  export name was disambiguated; the dual physical table is for the
  notifications/public-api owners.
- **`notifications-queue.spec.ts`** (pre-existing red on master, unrelated):
  asserts `/^notify:/` vs actual `notify-email`. Left as-is.

## NOT touched

- S22 impound module core tables/services (extended only: gate release sets
  `impound_records.released_at`/`status`, the documented integration point).
- `billing/invoices.service.ts` core, the jobs module, Fleet-owned data
  (vehicles/drivers read-only).

## Test coverage

- `pnpm typecheck` — green across all 6 packages.
- `pnpm biome check` (changed files) — clean.
- `pnpm build` — green (web requires `NEXT_PUBLIC_API_URL`, the R-14 guard).
- `vitest` (api) — 45 new yard unit tests pass; DB-gated specs skip without a
  database (run in CI with `DATABASE_URL`). One pre-existing unrelated failure
  (`notifications-queue.spec.ts`) documented above.

## Known issues

- Auto-billing only bills stall-assigned vehicles (by design — see §9); a stored
  vehicle never placed in a stall accrues no rate-card charge.
- Integration/RLS specs are verified in CI (need Postgres); not run in this
  session's environment.

## Commands

```
pnpm typecheck
pnpm biome check .
pnpm --filter @ustowdispatch/api exec vitest run src/modules/yard
NEXT_PUBLIC_API_URL=https://api.towcommand.cloud pnpm build
# integration/RLS (needs a DB):
DATABASE_URL=postgres://… pnpm --filter @ustowdispatch/api exec vitest run test/yard-rls.spec.ts test/yard-billing-release.spec.ts
```
