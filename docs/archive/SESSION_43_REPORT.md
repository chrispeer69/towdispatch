# Session 43 Report — Fraud Detection on Motor Club Disputes

## TL;DR

Shipped the defensive analytics layer that scores each job's fraud/dispute
risk **before** invoice submission and flags anomalies **after** a dispute
lands: a pure, fully-unit-tested 9-signal detector engine + weighted composite
scorer; a NestJS module (service + controller + env-gated nightly re-score
cron); shared Zod contracts; 4 RLS'd tables; and a web surface (risk queue /
job-risk detail / dispute log / reports). It reads existing job/invoice/
evidence/payment data and never blocks invoicing — **advisory only**. It plugs
into motor-club ingestion data (S13/S18-21/S28/S30/S34) with no schema change
when those partner-clocked sessions land. Signal weights + band thresholds are
best-effort heuristics (`fraud-v1.0`) documented in `SESSION_43_DECISIONS.md`.

Verification: workspace typecheck ✅ · 452 API tests pass (35 new fraud-engine
assertions) ✅ · fraud web helper spec passes ✅ · shared/db/api builds ✅ ·
web build ✅ (5 `/fraud` routes) · biome clean on changed files ✅.

## What shipped (✅)

- **DB** — `0043_fraud_detection.sql` + 4 Drizzle schema files:
  `fraud_risk_signals`, `fraud_risk_scores` (job_id PK), `dispute_records`,
  `dispute_outcomes` (FORCE RLS, audit triggers, cross-tenant consistency
  triggers, soft delete). Idempotency: one live signal per (job, signal_type)
  via partial unique index ⇒ re-scoring is a clean upsert.
- **Signal engine** (pure) — `fraud-signals.logic.ts` (9 detectors +
  `runAllDetectors` + `computeCompositeScore` + `bandForScore` + `haversineMiles`)
  and `fraud-rules.config.ts` (per-signal weights, severity multipliers, band
  thresholds, per-detector thresholds, `MODEL_VERSION`). Detectors are pure,
  consume one `JobFraudFacts`, and return `null` on missing data.
- **API** — `FraudDetectionService` (scoreJob, recordDispute, resolveDispute,
  recordOutcome, listHighRisk, getJobRisk, listDisputes, disputeStats,
  reviewScore); `FraudDetectionController` (`/fraud-detection`, tenant-scoped
  `RolesGuard`); `FraudScoreCron` (env-gated `30 3 * * *`, re-scores jobs
  invoiced in the last 24h). Wired into `app.module.ts`;
  `FRAUD_SCORE_CRON_ENABLED` added to `config.schema.ts`. Inline data access;
  jobs/invoices/payments/evidence read-only.
- **Shared contracts** — `packages/shared/src/fraud-detection/` (signals,
  scores, disputes, outcomes, detail) + barrel export.
- **Web** — `/fraud` (risk queue, band filters), `/fraud/[jobId]` (score
  breakdown + signals + review actions + log-dispute), `/fraud/disputes`
  (dispute log w/ resolve + ground-truth outcome entry), `/fraud/reports`
  (per-club win-rate + recovered-$ table); BFF catch-all + `fraud-client.ts`;
  `Fraud Risk` sidebar entry (Insights).
- **Tests** — 35 engine unit assertions (each detector pos/neg/edge + composite
  weighting + band boundaries); RLS spec (cross-tenant on all 4 tables + FK
  consistency); integration spec (seed → scoreJob → band → dispute → resolve →
  outcome → stats → cron); web ui-helper spec (5).

## Decision log

See `SESSION_43_DECISIONS.md`. Headlines: advisory-only (never blocks an
invoice); documented heuristic weights + band thresholds (`fraud-v1.0`,
ML-upgrade path via `model_version`); pre-submit hook = the score endpoint, no
per-tenant opt-in; off-hours uses a UTC approximation + default 06:00–22:00;
geofence "actual" coords deferred to telemetry (detector ready); migration 0043
gap reconciled at merge time (check-migrations not in CI).

## Deferred (🟡)

- ML training pipeline on `dispute_outcomes`; motor-club-specific signal tuning;
  real-time (event-driven) scoring; per-tenant rule/threshold overrides;
  per-tenant pre-submit opt-in; telemetry-based geofence actual coords;
  per-tenant operator hours + timezone. Full list in the decisions doc.

## What was NOT touched

- Motor-club ingestion (parked S13/S18-21/S28/S30/S34); the invoice / payment /
  jobs modules (read-only — direct table reads, no module imports); `auth/` and
  the staff user model; `scripts/check-migrations.sh`; shared contracts outside
  `fraud-detection/`.

## Test coverage

- `apps/api/src/modules/fraud-detection/fraud-signals.logic.spec.ts` — 35
  (9 detectors × pos/neg/edge, composite weighting, band boundaries, haversine).
- `apps/api/test/fraud-detection-rls.spec.ts` — cross-tenant isolation + FK
  consistency on all 4 tables (DB-gated).
- `apps/api/test/integration/fraud-detection.spec.ts` — full flow on a synthetic
  3-signal job + dispute lifecycle + stats + observation cron (DB-gated).
- `apps/web/src/app/(app)/fraud/fraud-ui-helpers.spec.ts` — 5.

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres; they
  run in the docker/CI DB path (mirrors every other module's RLS/integration specs).
- `geofence_violation` cannot fire in production until telemetry/evidence-GPS is
  wired (actual drop-off is null); the detector + tests are complete.
- `off_hours_dispatch` uses UTC + default hours until per-tenant timezone config exists.
- Signal weights are best-effort heuristics, not a trained model — review before
  treating scores as anything but triage hints.
- Pre-existing local-only web unit failures (`offline-queue.spec`,
  `reporting.spec` — `cache is not a function`) are unrelated to this session and
  not in CI (only `e2e.yml` runs); the new fraud web spec passes.

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 452 pass (35 fraud); DB specs skip
pnpm -F @ustowdispatch/api exec vitest run src/modules/fraud-detection/fraud-signals.logic.spec.ts
pnpm -F @ustowdispatch/shared -F @ustowdispatch/db -F @ustowdispatch/api run build
pnpm -F web run build
# enable the cron in prod: FRAUD_SCORE_CRON_ENABLED=true
```
