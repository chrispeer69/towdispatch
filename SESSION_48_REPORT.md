# Session 48 Report — EV-Specific Recovery Workflows

## TL;DR

Shipped an EV-aware recovery layer over the dispatch (jobs) module: a pure,
fully-unit-tested equipment + thermal-escalation + OEM-match engine; a NestJS
module (operator controller + driver-JWT controller, no cron); a `0042`
migration with 4 tables (3 tenant-scoped + 1 global OEM reference); shared Zod
contracts; an operator console EV panel and an in-truck driver surface; and an
`ev-recovery` report. Every modern EV defaults to **flatbed-only**; the OEM
tow/HV steps are best-effort and flagged for service-manual verification (see
`SESSION_48_DECISIONS.md`). Dispatch core was not modified.

Verification: workspace typecheck ✅ · 346 API tests pass (24 new EV unit
assertions) ✅ · web EV helper spec 10/10 ✅ · biome clean on all 29 changed
files ✅ · shared/db/api/web builds ✅.

## What shipped (✅)

- **DB** — `0042_ev_recovery.sql` + 4 Drizzle schema files: `ev_oem_procedures`
  (global reference, no RLS, seeded with 15 EVs), `ev_job_attributes`
  (FORCE RLS, 1:1 per job), `ev_thermal_events`, `ev_charge_station_visits`
  (FORCE RLS). Audit triggers + cross-tenant job-consistency triggers + soft
  delete on the tenant tables.
- **Rule engine** (pure) — `ev-rules.logic.ts` + `ev-tow-profiles.config.ts`:
  `requiredEquipmentForEv(facts) → { flatbedRequired, dolliesAllowed, … }`
  (unknown/Tesla → flatbed; Bolt/Leaf short-move; low-SOC override),
  `thermalEventEscalation(severity)` (fixed conservative matrix),
  `matchOemProcedure(rows, make, model, year)` (model + year-range matching).
- **API** — `EvRecoveryService` (markJobEv / recordIntake / getJobDetail /
  lookupOemProcedure / listOemProcedures / reportThermalEvent / logChargeStop);
  `EvRecoveryController` (`/ev-recovery`, tenant-scoped `RolesGuard`);
  `DriverEvController` (`/driver-ev`, `DriverAuthGuard`); wired into
  `app.module.ts`; `EV_RECOVERY_ENABLED` in `config.schema.ts`. Inline data
  access. No cron.
- **Shared contracts** — `packages/shared/src/ev-recovery/` (equipment,
  thermal-events, oem-procedures, charge-stops, attributes + detail) + barrel +
  main-index export.
- **Web (operator)** — `/jobs/[jobId]/ev` (equipment badge incl. FLATBED ONLY
  pill, charge-state intake, OEM procedure card, thermal-event reporter,
  charge-stop log); BFF catch-all + `ev-client.ts`; a contextual link from the
  job detail page.
- **Web (driver)** — `/driver/jobs/[jobId]/ev` (EV badge, OEM procedure
  pre-load, 2-tap thermal quick-report with bilingual evacuation warning) via
  `driverApi` + `size="touch"` targets; a link from the driver job page.
- **Reports** — single `ev-recovery` report (EV jobs by month · thermal events
  by severity · charge stops + reimbursable cost) wired into the reporting
  module (service, module, RBAC, titles, web dimensions).
- **Tests** — 24 engine unit assertions (equipment 9, thermal 6, OEM-match 9),
  10 web UI-helper assertions, an EV RLS spec (cross-tenant on all 3 tenant
  tables + the OEM global-ref check), and an integration spec (mark EV → intake
  → thermal escalation → charge stop, DB-gated).

## Decision log

See `SESSION_48_DECISIONS.md`. Headlines: flatbed-only conservative default;
best-effort OEM steps (verify before field use); dedicated driver controller
(not a relaxed operator guard); one ReportId for all three report asks;
English console with a bilingual thermal safety line; migration `0042` holds
the gap past the parallel sessions.

## Deferred (🟡)

OEM-direct API integration (partner clock parked); automated OEM procedure
updates; customer-facing EV safety brief; battery-fire suppression
recommendations (parked); operator distance-override on the EV panel. Full
list in the decisions doc.

## What was NOT touched

Dispatch core (jobs module API/schema/state machine), motor-club /
police-rotation code, `auth/`, the S36 heavy-duty tables, shared contracts
outside `ev-recovery/`, `scripts/check-migrations.sh`. Only EV filter helpers
read the jobs table (read-only).

## Test coverage

- `apps/api/src/modules/ev-recovery/ev-rules.{equipment,thermal,oem-match}.spec.ts`
  — 24 assertions.
- `apps/web/src/lib/ev/ev-ui-helpers.spec.ts` — 10 assertions.
- `apps/api/test/ev-recovery-rls.spec.ts` — cross-tenant isolation + FK
  consistency + 1:1 unique + OEM global-ref visibility (DB-gated).
- `apps/api/test/integration/ev-recovery.spec.ts` — full lifecycle (DB-gated).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres; they
  run in the docker/CI DB path (mirrors every other module). Docker was
  unavailable in this session, so the migration + RLS + integration specs were
  not executed locally — they run in CI.
- `apps/web` `offline-queue.spec.ts` fails locally (pre-existing
  `window.location`/env gap, driver code, not in CI) — not a regression.
- OEM tow/HV steps are best-effort and require service-manual verification
  before field reliance (loud disclaimer in code + decisions doc).

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 346 pass (24 EV); DB specs skip
pnpm -F web exec vitest run src/lib/ev     # 10 pass
pnpm -F @ustowdispatch/shared -F @ustowdispatch/db -F @ustowdispatch/api run build
pnpm -F web run build
npx biome check apps/api/src/modules/ev-recovery packages/shared/src/ev-recovery
# ops kill-switch (default on): EV_RECOVERY_ENABLED=false
```
