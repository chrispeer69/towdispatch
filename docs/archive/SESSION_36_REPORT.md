# Session 36 Report — Heavy-Duty Specialist Module

## TL;DR

Shipped an HD-aware layer (Class 7/8 + commercial recovery) on top of the
existing truck / driver / job entities — **no fork**. DB: migration `0040` + 4
FORCE-RLS / audited / soft-delete tables. API: a NestJS module with pure
eligibility + rate-math helpers, an upsert-style service, a tenant-scoped
controller, an env-gated observation-only cert-expiry cron, and three reports.
Shared Zod contracts, a full web surface (overview + truck capabilities +
driver certs + HD job intake/eligibility/estimate + rate-sheet editor), and a
sidebar entry.

Verification: workspace typecheck ✅ · **350 API tests pass (28 new HD unit
assertions)** ✅ · web typecheck + web helper spec ✅ · biome clean on changed
files ✅ · shared/db/api/web builds ✅ (all 6 HD routes in the manifest).

## What shipped (✅)

- **DB** — `0040_heavy_duty.sql` + 4 Drizzle schema files:
  `hd_truck_capabilities` (1:1 truck), `hd_driver_certifications` (1 live per
  driver/type), `hd_job_attributes` (1:1 job), `hd_rate_sheets` (tenant rate
  cards). FORCE RLS + audit + shared `updated_at` trigger on all four;
  cross-tenant consistency triggers on the three child tables; partial unique
  indexes; CHECK constraints (GVWR class 3–8, incident enum, non-neg money,
  multipliers in [1,10]).
- **Pure logic** — `heavy-duty-eligibility.logic.ts` (`gvwrLbsToClass`,
  `eligibleTrucksForHdJob`, `eligibleDriversForHdJob`, `certStatus`) +
  `heavy-duty-rates.logic.ts` (`computeOnSceneEstimate`, `effectiveMultiplier`).
- **API** — `HeavyDutyService` (setTruckCapabilities + heavy_duty_capable sync,
  recordDriverCert, markJobHd, getJobDetail w/ eligibility, generateOnSceneEstimate
  [persisted], finalizeHdInvoice, rate-sheet CRUD, 3 reports);
  `HeavyDutyController` (`/heavy-duty`, tenant-scoped `RolesGuard`);
  `HeavyDutyCertExpiryCron` (env-gated `0 4 * * *`, observation-only). Wired
  into `app.module.ts`; `HD_CERT_EXPIRY_CRON_ENABLED` added to `config.schema.ts`.
  Inline data access (no repository).
- **Shared contracts** — `packages/shared/src/heavy-duty/` (enums, capabilities,
  certifications, job-attributes, rate-sheets, eligibility, reports) + barrel,
  exported from the package root.
- **Web** — `/heavy-duty` overview (3 reports + rate-sheet snapshot + stat
  cards + job lookup), `/heavy-duty/trucks` (capability editor w/ truck picker),
  `/heavy-duty/drivers` (cert list + record/renew), `/heavy-duty/jobs/[jobId]`
  (mark HD + eligible trucks/drivers panels + on-scene estimate + finalize),
  `/heavy-duty/rate-sheets` (CRUD). BFF catch-all proxy; `heavy-duty-client.ts`;
  `Heavy-Duty` sidebar entry.
- **Reports** — HD jobs by month (count/revenue/avg ticket), cert-expiry roster
  (next N days), equipment utilization (rotator jobs / total).
- **Tests** — eligibility unit spec (20 assertions incl. cert-expiry edges),
  rate-math unit spec (8), web helper spec (5); HD RLS spec (cross-tenant on all
  4 tables + the two unique indexes, DB-gated); integration spec (full flow:
  capabilities → certs → mark HD → eligibility → estimate → finalize → reports →
  observation-only cron, DB-gated).

## Decision log

See `SESSION_36_DECISIONS.md`. Headlines: HD as a job attribute (no jobs fork);
`heavy_duty_capable` stays the hot-path flag, capabilities row is authoritative
(service syncs the flag, no trucks-module change); hazmat is a driver cert (no
truck hazmat column); multipliers don't stack (higher wins); observation-only
cron; reports as HD-module endpoints (not the central registry); web under
`src/app/(app)/`.

## Deferred (🟡)

- DOT report rendering + hazmat compliance reporting → **Session 37** (per
  DO-NOT). `requires_dot_report` is captured now.
- Telematics integration; dynamic VIN→GVWR lookup.
- Cert-expiry → `NotificationModule` alerts (cron is observation-only).
- HD reports into the central reporting registry (export/scheduling/caching).
- Finalized HD invoice → billing/AR linkage.

## What was NOT touched

- The jobs / dispatch core (only added `hd_job_attributes` alongside + read-only
  eligibility filter helpers), the trucks/drivers schema (only a tenant-scoped
  `heavy_duty_capable` flag write from the HD service), the fleet module, the
  central reporting module, the impound / lien modules.

## Test coverage

- `apps/api/src/modules/heavy-duty/heavy-duty-eligibility.logic.spec.ts` — 20
  (GVWR brackets, class/rotator/weight gates, CDL rules, cert-expiry edges,
  status windows).
- `apps/api/src/modules/heavy-duty/heavy-duty-rates.logic.spec.ts` — 8 (line
  emission, rounding, multiplier no-stack, empty estimate).
- `apps/web/src/app/(app)/heavy-duty/hd-ui-helpers.spec.ts` — 5.
- `apps/api/test/heavy-duty-rls.spec.ts` — cross-tenant isolation + FK
  consistency + unique indexes (DB-gated).
- `apps/api/test/integration/heavy-duty.spec.ts` — full lifecycle + reports +
  cron observation-only (DB-gated).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres; they
  run in the docker/CI DB path (mirrors every other module's RLS/integration
  specs). The shared integration `tearDown()` was extended to clear the HD
  tables (`hd_rate_sheets` explicitly; the three child tables FK-cascade with
  trucks/drivers/jobs).
- Migration was renumbered `0039 → 0040` at the merge with master (master had
  advanced to `0039_tenant_preferred_region`); `0040` only depends on
  pre-existing parents, so ordering after region is safe (see decisions doc).
- Only the targeted web helper spec was run (`hd-ui-helpers.spec`), not the full
  `pnpm -F web test`. The pre-existing `offline-queue.spec` failure
  (driver-app `window.location`/env gap, not in CI) is unrelated to this session
  and is the only known failure in the full web suite.

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 350 pass (28 HD); DB specs skip
pnpm -F web test                            # HD helper spec passes
pnpm -F @ustowdispatch/shared -F @ustowdispatch/db -F @ustowdispatch/api run build
pnpm -F web run build
# enable the cron in prod: HD_CERT_EXPIRY_CRON_ENABLED=true
```
