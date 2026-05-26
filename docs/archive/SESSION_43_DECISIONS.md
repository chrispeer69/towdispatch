# Session 43 — Decision Log: Fraud Detection on Motor Club Disputes

Every call made without the owner, with rationale. Companion to
`SESSION_43_REPORT.md`.

---

## 1. Advisory only — never blocks invoicing (v1)

Scoring is informational. `POST /fraud-detection/jobs/:id/score` returns a risk
assessment but the system never blocks or mutates an invoice, and never
auto-resolves a dispute. Every action (mark-reviewed / hold-invoice / escalate
/ resolve / outcome) is an explicit operator decision. Auto-blocking billing on
a heuristic score is exactly the kind of automation that generates operator
distrust and false-positive revenue loss. Mirrors the lien module's
"observation only" posture.

## 2. Migration number 0043 + the 0039–0042 gap

The launch assigned `0043_fraud_detection.sql`. `origin/master`'s latest is
`0038`; `0039–0042` are reserved by the other in-flight parallel sessions
(S37 dot-compliance, S42 damage-analysis, etc.). I kept 0043 as assigned:

- `packages/db/migrate.ts` re-applies every `sql/*.sql` in lexicographic order
  on each run and does **not** track applied files — every statement is
  idempotent (`CREATE … IF NOT EXISTS`, `DROP … IF EXISTS`, `CREATE OR REPLACE`),
  so a numbering gap is harmless at runtime.
- `scripts/check-migrations.sh` (which enforces contiguous numbering) is **not**
  referenced by any CI workflow (only `e2e.yml` runs). `master` itself already
  ships two `0036_*.sql` files from parallel sessions, confirming this check
  doesn't gate feature branches.
- Final contiguity is resolved at merge time — the same renumber pattern S23
  used (`renumber migration to 0038`).

## 3. Signal weights (the heuristic v1 model)

`SIGNAL_WEIGHTS` in `fraud-rules.config.ts` — base points at full (high)
severity and 100% confidence. A signal contributes
`weight × severityMultiplier × (confidence/100)`; summed, clamped 0-100.

| Signal | Weight | Why |
|---|---|---|
| `duplicate_invoice` | 45 | Double-billing the same vehicle to the same club — the canonical fraud. |
| `geofence_violation` | 40 | Drop-off far from the billed address ⇒ billing for service not rendered. |
| `bill_to_storage_acceleration` | 40 | Storage days billed beyond the actual gap ⇒ direct overbilling. |
| `excessive_mileage` | 30 | Mileage padding — billed miles materially exceed the geocoded route. |
| `missing_evidence` | 25 | Thin documentation on a high-value invoice ⇒ high dispute-loss exposure. |
| `rapid_resequencing` | 20 | Lifecycle thrash — status flipped repeatedly, a manipulation tell. |
| `cash_only_pattern` | 20 | Revenue-leakage / off-books pattern across a customer's cash jobs. |
| `driver_anomaly` | 20 | Volume outlier — a driver far above their own 30-day baseline. |
| `off_hours_dispatch` | 15 | Lowest-signal context flag; corroborates, rarely stands alone. |

`SEVERITY_MULTIPLIER`: info 0, low 0.4, medium 0.7, high 1.0. (info contributes
nothing — it's a surfaced-but-not-scored note.)

These are best-effort heuristics, **not** a trained model. `MODEL_VERSION =
'fraud-v1.0'` stamps every signal + score so a future fitted model can coexist
and be A/B-compared. Tuning is a one-file edit.

## 4. Score → risk band thresholds

`low < 30 · medium 30–59 · high 60–79 · critical 80+` (per the spec). One strong
high-confidence fraud signal (e.g. duplicate ≈ 41 pts) lands in **medium**; two
stacked strong signals reach **high/critical**; a lone documentation gap stays
**low/medium**. Verified in `fraud-signals.logic.spec.ts`.

## 5. Per-detector thresholds + conservative posture

- Detectors are **pure** and **never half-fire**: when a fact source is
  unavailable they return `null` (no false positive on missing data). The
  service assembles a single `JobFraudFacts` object; all 9 detectors consume it.
- `duplicate_invoice`: same VIN + motor club within ±2 days.
- `excessive_mileage`: billed loaded-mile quantity ÷ geocoded `intow_miles` > 1.3.
- `rapid_resequencing`: > 3 status reversals (a transition to a lower lifecycle rank).
- `missing_evidence`: invoice ≥ $500 with < 2 `photo_*` evidence rows.
- `driver_anomaly`: driver's jobs-on-day ≥ 2× their 30-day average/day.
- `cash_only_pattern`: ≥ 3 cash-paid jobs for the same customer.
- `geofence_violation`: > 5 mi between billed and actual drop-off.
- `bill_to_storage_acceleration`: billed storage days > actual impound gap.

## 6. Off-hours dispatch uses a UTC approximation + default hours

There is no per-tenant timezone or operator-hours config yet, so v1 computes the
dispatch hour in **UTC** and compares against a default window
(`06:00–22:00`). Documented as a known limitation; per-tenant hours + timezone
are deferred (§10). The `after_hours` invoice line item suppresses the signal
(legitimately-flagged after-hours work).

## 7. Geofence "actual" coordinates deferred to telemetry

`billed_dropoff` comes from `jobs.dropoff_lat/lng`. There is no reliable
"actual" drop-off coordinate today (driver telemetry / evidence-GPS is not
wired), so the service passes `actualDropoff = null` and the detector skips. The
detector is fully implemented + unit-tested against synthetic facts, ready to
light up the moment telemetry lands — no schema change required.

## 8. Pre-submit hook = the score endpoint; no per-tenant opt-in (deferred)

The "optional pre-submit hook" is `POST /fraud-detection/jobs/:id/score` — a
pull-from-client call that returns the assessment before invoice finalization.
There is deliberately **no** middleware on invoice creation and **no** per-tenant
opt-in toggle column in S43 (kept the invoice/payment modules read-only). A
per-tenant opt-in setting is deferred.

## 9. Architecture / wiring decisions

- **Inline data access** (no repository), mirroring lien + impound.
- **Read-only on jobs/invoices/payments/evidence**: the service reads those
  tables directly via the tenant-aware Drizzle handle; it never imports the
  `invoices` / `payments` / `jobs` modules.
- **Re-score = upsert**: `scoreJob` soft-deletes the prior live signal set
  (so the `(job_id, signal_type)` partial-unique index stays clean) and inserts
  the fresh set; the score row upserts `ON CONFLICT (job_id)` and clears any
  prior review. `fraud_risk_scores.job_id` is the actual primary key.
- **Cron** (`FRAUD_SCORE_CRON_ENABLED`, `30 3 * * *`, default off): enumerates
  `(tenant_id, job_id)` for invoices issued in the last 24h via the admin pool
  (cross-tenant), then re-scores each through the tenant-aware service so RLS +
  the detectors run identically to a manual score. Per-job try/catch; one
  failure never aborts the sweep. Actor GUC is empty ⇒ `fn_current_user_id()`
  resolves NULL (system mutation), same as the lien cron.
- **`dispute_outcomes.signal_id`** is nullable + `ON DELETE SET NULL` so
  historical ground truth survives a re-scored (soft-deleted) signal.
- **Web path**: built under `apps/web/src/app/(app)/fraud/` (repo convention),
  not the launch's literal `apps/web/app/fraud/`.
- **RBAC**: writers = OWNER/ADMIN/DISPATCHER; readers add AUDITOR;
  MANAGER/ACCOUNTING/DRIVER get a friendly 403 (mirrors reporting + lien).

## 10. Deferred (🟡)

- ML training pipeline that consumes `dispute_outcomes` (model v2).
- Motor-club-specific signal tuning / per-club weight overrides.
- Real-time scoring (event-driven on invoice finalization) — v1 is on-demand + nightly.
- Per-tenant rule/threshold overrides (same pattern lien deferred).
- Per-tenant pre-submit opt-in toggle.
- Telemetry / evidence-GPS-based actual drop-off for `geofence_violation`.
- Per-tenant operator hours + timezone for `off_hours_dispatch` (UTC approx today).
- Plugging the detectors into motor-club ingestion data when S13/S18-21/S28/S30/S34 land.
