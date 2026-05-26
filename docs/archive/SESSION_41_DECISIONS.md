# Session 41 — Decision Log: AI Smart Dispatch + Predictive ETAs (advisory v1)

Every non-obvious call made while building Session 41, with rationale. Paired
with SESSION_41_REPORT.md.

---

## 1. "Candidate" = an active driver shift, not a truck row

The launch said *"distance_score — Haversine truck.last_lat/lng"*. The `trucks`
table has **no** live position columns. Live GPS lives on `driver_shifts`
(`last_lat` / `last_lng` / `last_position_at`, plus `truck_id`). So a scoring
candidate is an **active shift** (a driver + a truck + a position), which is
exactly the unit dispatch assigns. Shifts with `truck_id IS NULL` are skipped
(no truck to dispatch). Shifts with a null position score neutral (50) on
distance rather than being excluded — the engine degrades gracefully.

## 2. Fatigue from `driver_shifts` hours, not `job_assignments` count

The launch said *"read S37 dot_hos_logs if available, else fallback to
job_assignments"*. `dot_hos_logs` (Session 37) is **not on master** (parallel
branch). `job_driver_assignments` only carries `created_at` — a weak proxy.
`driver_shifts` carries real `started_at`/`ended_at`, so fatigue is computed as
**actual hours on shift in the last 24h** (overlap of each shift with the
window). This is strictly better data than the launch's fallback. FMCSA-style
mapping: ≤8h → fresh (100), linear to 0 at 14h (HOS ceiling).

## 3. Migration number 0045, with a gap

Master tops out at `0042_ev_recovery.sql`; `0043`/`0044` are claimed by parallel
feature sessions. Per the migration-numbering convention (the runner re-applies
every idempotent `sql/*.sql` each run; gaps are harmless), `0045` is kept as
launch-assigned and only depends on pre-existing tables (jobs/tenants/trucks/
drivers). Contiguity reconciled at merge.

## 4. Factor weights (defaults, env-overridable)

Integer "points", normalised by their sum at runtime (so they need not total
100). Rationale:

| Factor | Points | Why |
|---|---|---|
| distance | 30 | Response time is the headline dispatch metric. |
| capability | 25 | A truck that physically can't do the job is useless. |
| cert_match | 15 | Legal/safety gate; high, below physical capability. |
| fatigue | 10 | Safety nudge; most drivers are within HOS so it rarely bites. |
| historical_performance | 10 | Data-driven, low until the feedback loop fills. |
| utilization_balance | 10 | Fairness / load spreading; a tie-breaker. |

Overridable via `AI_DISPATCH_WEIGHT_*` env. **Per-tenant** weight overrides are
deferred 🟡 (env is process-global; a `tenant_ai_dispatch_config` table is a
follow-up — "configurable per-tenant via env" in the launch is contradictory,
resolved as env-overridable defaults).

## 5. Heuristic ETA over ML for v1 (data collection first)

No third-party routing call this session. `predictEta` = distance-banded average
speed (urban 22 / suburban 34 / highway 50 mph) × a time-of-day/day-of-week
traffic multiplier (rush 1.4–1.5×, overnight 0.9×, weekend flat) + a per-tenant
historical-bias correction from the feedback loop. We collect real
(features → outcome) pairs in `eta_predictions` + `dispatch_outcomes` so a future
ML model has training data. Same posture as the fraud-engine model_version path.

Earth radius (3958.7613 mi) and the Haversine formula match
`dashboard.service.ts` so the predictive ETA never disagrees with the existing
ETA-board distance.

## 6. Pluggable `EtaProvider`; Mapbox is a stub

`HeuristicEtaProvider` (default) implements the contract; `MapboxEtaProvider` is
a wired stub that `throw`s "not implemented". `selectEtaProvider` only returns
Mapbox when `ETA_PROVIDER=mapbox` **and** a token is set; the service guards
every `predict()` with a heuristic fallback, so a misconfiguration can never
break recommendations. Implementing the Directions call is deferred 🟡.

## 7. Advisory only — never auto-assigns

There is deliberately **no** assign affordance in the engine, the API, or the
Smart Recommendations panel. The dispatcher still assigns from the dispatch
board. The recompute cron writes recommendation rows only. Dispatch core
(`jobs` / `driver_shifts` / the assignment flow) is untouched.

## 8. `was_top_recommendation` computed at `recordOutcome`

When a dispatcher's choice is recorded, the service loads the recommendation
(named, else the latest for the job — which may be **null** if the engine never
ran before assignment) and sets `was_top_recommendation` by comparing the chosen
truck+driver against `recommendations[0]`. The chosen candidate's
`predictedEtaMinutes` is pulled from the same set; `eta_error_minutes =
actual − predicted` when both are known. One outcome row per job (partial unique
on `job_id`), upserted so a reassignment / a late actual-ETA fill updates it.

## 9. ETA GET is read-only; POST persists

`GET /ai-dispatch/jobs/:id/eta` (and the driver/board surfaces that poll it)
computes **without** writing — no audit noise, RLS-safe, idempotent.
`POST /ai-dispatch/jobs/:id/eta` persists an `eta_predictions` row for the
feedback loop. This keeps the high-frequency read path side-effect-free.

## 10. jsonb column type mirrored locally in the db schema

The advisor suggested `jsonb('recommendations').$type<RecommendationItem[]>()`
importing from `@ustowdispatch/shared`. Importing a shared type into a db schema
file pulls shared **source** into the db tsc program and trips `TS6059`
(rootDir) — the repo convention (see `lien-state-rules.ts` / `rate-sheets.ts`)
is to **declare the jsonb shape locally**. So `RecommendationItemJson` mirrors
the shared `RecommendationItem` in `dispatch-recommendations.ts`, structurally
compatible so the service writes shared types without a cast.

## 11. Cron: `@Cron(EVERY_MINUTE)`, env-gated, cross-tenant via admin pool

"Every 60s" → `CronExpression.EVERY_MINUTE`. Gated by
`AI_DISPATCH_RECOMPUTE_CRON_ENABLED` (default false) so dev/CI don't churn.
Tenant discovery runs on the admin pool (cross-tenant read); the per-tenant
recompute runs in tenant context (RLS enforced) with the `00000000-…-0000`
system actor (mirrors `report-scheduler`). One failing tenant is logged and
skipped, never stalling the sweep. `ScheduleModule.forRoot()` is idempotent.

## 12. Reports on `/ai-dispatch/reports/*`, not the reporting module

Recommendation accuracy / ETA MAE / per-driver ranks are served from the
ai-dispatch controller (mirrors `heavy-duty/reports/cert-expiry`), not the
reporting rollup module — different surface. The web reports page proxies them.

## 13. "completed this week" uses `jobs.updated_at`

`jobs` has no `completed_at` column. The utilization factor approximates
weekly completions by `status='completed' AND updated_at >= startOfWeek`. Good
enough for a load-balance heuristic; documented so it isn't mistaken for a
precise completion timestamp.

## 14. Web driver only; iOS/Android deferred

The predictive ETA is shown on the **web** driver job page (and the operator
job-detail panel + dispatch-board pill + reports). The iOS/Android offer-card
ETA is deferred 🟡 — same precedent as EV recovery (no mobile changes). The
contract (`/driver-dispatch/jobs/:id/eta`) is ready for the mobile clients to
adopt.

## 15. RLS/integration tests in `apps/api/test/`, ranking test pure

The repo keeps DB-backed RLS specs in `apps/api/test/*-rls.spec.ts` (self-skip
without a DB) and pure-logic specs in `src/`. `ai-dispatch-rls.spec.ts` covers
the 3 tables' isolation + consistency triggers + the recommendation→outcome
round-trip. The launch's "synthetic 5-truck fleet → top-1" is satisfied as a
**pure ranking test** in `score-candidate.spec.ts` (the ranking is pure; no DB
needed). A full Nest-DI service integration test is deferred 🟡 — the repo has
no such harness and it wouldn't run in CI.
