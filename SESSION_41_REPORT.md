# Session 41 — AI Smart Dispatch + Predictive ETAs (advisory v1)

## TL;DR

Built an **advisory** dispatch-recommendation engine: it scores every eligible
(truck, driver) candidate for a job on six weighted factors, attaches a
predicted ETA, and surfaces a ranked shortlist to the dispatcher. It **never
auto-assigns** and **never touches dispatch core**. A feedback loop records what
the dispatcher actually chose + the realised ETA, powering accuracy reports and
a per-tenant ETA-bias correction — the data a future ML model would train on.

All pure scoring + ETA math is in unit-tested pure functions. Three new
FORCE-RLS, audited tables. Operator + driver + reporting surfaces in web.

Verification: `pnpm -r typecheck` ✓ · `biome check` ✓ (all touched files) ·
`pnpm --filter api test` ✓ (553 passed, 0 failed) · `pnpm -r build` ✓.

## What shipped ✅

**Data layer**
- ✅ `0045_ai_dispatch.sql` — `dispatch_recommendations`, `dispatch_outcomes`,
  `eta_predictions`. FORCE RLS + tenant-isolation policies, audit triggers,
  job-tenant consistency triggers, soft-delete, CHECK constraints, idempotent
  (mirrors `0042_ev_recovery.sql`).
- ✅ Drizzle schemas for all three + registered in `schema/index.ts`.

**Pure engine** (`apps/api/src/modules/ai-dispatch/`)
- ✅ `scoring/` — six factor functions (distance, capability, cert_match,
  fatigue, historical_performance, utilization_balance) + `scoreCandidate`
  composite with runtime weight normalisation. Weights documented + env-tunable.
- ✅ `eta/` — `EtaProvider` interface, `HeuristicEtaProvider` (distance-banded
  speed × time-of-day/day-of-week traffic × historical bias), `MapboxEtaProvider`
  stub, `selectEtaProvider`.

**API** (`SmartDispatchService` + `AiDispatchController` + `DriverDispatchController`)
- ✅ `recommendForJob` / latest recommendations, `predictEta` (read + persist),
  `recordOutcome` (feedback), 3 accuracy reports.
- ✅ Env-gated 60s recompute cron (`AI_DISPATCH_RECOMPUTE_CRON_ENABLED`).
- ✅ `config.schema.ts` + `config.service.ts` (`aiDispatch` getter), wired in
  `app.module.ts`.
- ✅ Tenant-scoped `RolesGuard` (operator) + `DriverAuthGuard` (driver ETA).

**Shared contracts** — `packages/shared/src/ai-dispatch/` (factors, eta,
recommendations, outcomes, reports), barrelled.

**Web**
- ✅ BFF proxy `/api/ai-dispatch/[...path]`, client lib, bilingual UI helpers.
- ✅ "Smart Recommendations" inline panel on job detail (top-3, factor
  breakdown, predicted ETA, recompute for writers).
- ✅ Predictive ETA pill on dispatch-board job cards (assigned/enroute jobs).
- ✅ `/ai-dispatch` reports page (top-1 accuracy, ETA MAE/bias, per-driver ranks)
  + sidebar nav.
- ✅ Driver job page: bilingual (EN/ES) predicted-ETA card (display-only).

**Tests** — `factors.spec.ts` (30), `score-candidate.spec.ts` (7, incl. the
synthetic 5-truck top-1 ranking), `heuristic-provider.spec.ts` (15),
`smart-dispatch.fatigue.spec.ts` (5); `test/ai-dispatch-rls.spec.ts` (10, RLS +
consistency triggers + recommendation→outcome round-trip, self-skips w/o DB).

## Deferred 🟡

- 🟡 **Per-tenant weight overrides** — env-overridable defaults only this session
  (a `tenant_ai_dispatch_config` table is the follow-up).
- 🟡 **Mapbox/Google routing** — `MapboxEtaProvider` is a wired stub; heuristic
  is the only live provider.
- 🟡 **ML training pipeline** — v1 only collects (features → outcome); no model.
- 🟡 **iOS/Android offer-card ETA** — contract ready (`/driver-dispatch/...`);
  web driver shipped, mobile is a follow-up (EV-recovery precedent).
- 🟡 **Multi-job optimisation** — v1 scores candidates per job independently.
- 🟡 **Full Nest-DI service integration test** — no DB-backed service harness in
  the repo; covered by the pure ranking test + the SQL round-trip RLS spec.

## NOT touched

- Dispatch core: `jobs`, `driver_shifts`, the assign/unassign flow, the
  dispatch board's DnD assignment — read-only consumption only.
- Driver-app job-acceptance / transition logic — ETA is display-only.
- The existing `/dashboard/eta-board` + `/active-etas` ETA-triage surface.

## Test coverage

| Area | Spec | Status |
|---|---|---|
| Six factor functions (edge cases) | `scoring/factors.spec.ts` | ✓ 30 |
| Composite scoring + normalisation + 5-truck top-1 | `scoring/score-candidate.spec.ts` | ✓ 7 |
| ETA heuristic (rush/off-peak/weekend/bias/missing) | `eta/heuristic-provider.spec.ts` | ✓ 15 |
| Fatigue window helper | `smart-dispatch.fatigue.spec.ts` | ✓ 5 |
| RLS + triggers + round-trip (3 tables) | `test/ai-dispatch-rls.spec.ts` | ✓ 10 (skip w/o DB) |

Full api suite: **553 passed, 480 skipped (DB-backed), 0 failed.**

## Known issues / notes

- The recompute cron and the RLS/round-trip specs require a live Postgres; they
  self-skip locally (same as every other RLS spec — only e2e runs in CI).
- Utilization "completed this week" uses `jobs.updated_at` (no `completed_at`
  column) — a documented heuristic approximation.
- Migration is `0045` with a 0043/0044 gap (parallel sessions) — harmless under
  the idempotent runner; reconcile contiguity at merge.

## Commands

```bash
pnpm -r typecheck
pnpm biome check apps/api/src/modules/ai-dispatch packages/shared/src/ai-dispatch
pnpm --filter @ustowdispatch/api test
pnpm -r build

# Enable the advisory recompute cron (default off):
AI_DISPATCH_RECOMPUTE_CRON_ENABLED=true
# Tune factor weights (points; normalised at runtime):
AI_DISPATCH_WEIGHT_DISTANCE=30 AI_DISPATCH_WEIGHT_CAPABILITY=25 ...
```
