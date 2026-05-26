# Session 54 — Yard Management: Decision Log

Operator yard floor layered **additively** over Session 22 impound: facilities,
stall map + photos, storage rate cards, daily auto-billing, a per-day charge
ledger, the gated release workflow, and gate search.

---

## 0. Base repair (committed separately as `chore(base): …`)

The branch base (`origin/master` @ 13439ba) did **not** type-check or build:
multiple prior merges had landed **committed conflict markers** and **eaten
join lines** (closing braces, `/**` openers, de-duplicated members), plus
three-way concatenations of whole files. The API package's `tsc` is not
CI-gated (only `web-ci.yml` runs typecheck, scoped to `apps/web`), so this rot
accumulated unnoticed.

**Decision:** repair the base in a dedicated first commit so Session 54 builds
verifiably. All repairs are pre-existing and unrelated to yard scope:

- Conflict markers (union resolution): `app.module.ts`, `config.schema.ts`,
  `config.service.ts`, web `settings/tabs.ts`, db `schema/index.ts`, shared
  `error-codes.ts`.
- Truncated zod chains restored: `AUCTION_LIFECYCLE_CRON_ENABLED`,
  `FRAUD_SCORE_CRON_ENABLED`, `DAMAGE_ANALYSIS_WORKER_ENABLED`.
- Two/three-version concatenations un-merged: `sentry.edge/server.config.ts`,
  web `marketplace-client.ts`, `admin.controller.ts` + `admin.module.ts`,
  `jwt.service.ts`, `config.service.ts` jwt getter, `sidebar.tsx` (split nav
  item), and **`next.config.mjs`** (three competing `export default`s →
  `withSentryConfig(withNextIntl(nextConfig), …)`).
- Barrel name-collisions disambiguated (kept the runtime "last-wins" export as
  the bare name): shared `recordOutcome*` → `recordDisputeOutcome*` (fraud
  side); shared `WebhookDeliveryDto` → `PublicWebhookDeliveryDto` (public-api
  side); db `webhookDeliveries` → `notificationWebhookDeliveries` (notifications
  side).
- Stale specs realigned to current ctors (`TenantAwareDb` +replica/+config,
  `HealthMetricsController` +region, `AdminController` +service).

**NOT fixed (out of scope, pre-existing red):** `notifications-queue.spec.ts`
asserts `/^notify:/` but `NOTIFY_QUEUE_NAMES` already uses `notify-email`
(hyphen) on master — unrelated to yard, left as-is. And notifications +
public-api both physically name a `webhook_deliveries` table (see §10).

---

## 1. Stall coordinate model — grid `x`/`y` (chosen)

Stalls carry integer `(x, y)` grid cells plus optional `row`/`col` human
labels. The web map is a CSS grid; drag-drop writes new `(x, y)` via
`bulkLayout`. **Pixel-canvas was considered and rejected**: a free pixel
canvas needs zoom/pan, collision math, and a real diagramming lib for marginal
operator value; a grid maps cleanly to "row A, stall 12" the way a yard is
actually striped, and serialises to two ints.

## 2. Rate-card resolution — most-recent-effective-on-date

`resolveRate(cards, chargeDate)` filters to cards whose
`[effective_from, effective_to]` window covers the date and returns the one
with the **latest `effective_from`** (most recent override wins). **Fallback
when none defined:** returns `null`; the billing engine then **skips** that
vehicle for the day rather than charging `$0`. Overlapping windows for the same
`(facility, vehicle_class)` are rejected at write time
(`rateWindowsOverlap`), so resolution is always unambiguous.

## 3. Free-days semantics — UTC calendar days from storage start

`dayIndex = diffUtcDays(storage_started_at, charge_date)` (0 = arrival day). A
partial day counts as a full day (industry standard, mirrors S22 impound). The
first `free_days` indices are waived; thereafter the daily rate applies, capped
by `max_daily_rate_cents` when set. This matches operator intuition: "first 3
days free" means the arrival day + the next two.

## 4. `classifyVehicle` heuristic (each branch)

Storage class is derived from the linked vehicle (impound `vehicle_id`) by
first-match order, documented in `storage-rate.logic.ts`:

1. **motorcycle** — dispatch class `motorcycle` or body contains
   `motorcycle`/`moped`.
2. **trailer** — body contains `trailer`.
3. **rv** — dispatch class `rv` or body `rv`/`motorhome`/`recreational`.
4. **heavy** — GVWR ≥ 26 001 lbs (US Class 7-8), or ≥ 3 axles, or dispatch
   class `heavy_duty`/`commercial`.
5. **light_truck** — dispatch class `medium_duty`, GVWR 10 001-26 000, or body
   `pickup`/`truck`/`van`/`suv`.
6. **passenger** — `light_duty`/`sedan`/`car`/everything else (safe default).

Body categories win over weight (a motorcycle is never "heavy"). **GVWR/axle
are not on the `vehicles` table** — those signals are wired only when present
(future: read `hd_job_attributes`); today heavy classification leans on the
dispatch class. Documented follow-up.

## 5. Release workflow — 4 steps confirmed (id → lienholder → payment → gate)

States: `initiated → id_verified → lienholder_authorized → payment_collected →
gate_released`, plus `cancelled` from any non-terminal state. Gates
(`evaluateReleaseTransition`): payment and lienholder both require ID verified
first; the **gate cannot open without EITHER a collected payment OR a recorded
lienholder authorization** (the insurance/total-loss path). **Lienholder is
therefore optional** — an owner who pays cash skips it. No state was added
beyond the spec's six. Each step is idempotent: re-calling a satisfied step
returns the current row, never an error.

## 6. Storage charges → invoice: roll at release — **DEFERRED (🟡)**

The spec's preferred UX is "cron writes pending charges; release packages them
into an invoice." The charge ledger (`storage_charges`) ships and is the
queryable source of truth. **Invoice integration is deferred** rather than
forking `billing/invoices.service.ts` (explicit DO-NOT-touch-core), which has a
non-trivial line-item/contract surface. The seam is clean: at gate release the
`storage_charges` rows for the impound are available to roll up; wiring an
append-only invoice line is a follow-up that the billing module owner should
review. Gate release records the payment on the workflow row in the meantime.

## 7. `yard_facilities` is a NEW concept, distinct from S22 `impound_yards`

The two coexist. `impound_records.yard_id` keeps pointing at `impound_yards`;
facilities own the stall map + rate cards. A vehicle's **facility for billing
is derived from the stall it occupies** (see §9), bridging the two models
without altering S22.

## 8. `storage_charges` is INDEPENDENT of S22 `impound_fees`

Two ledgers can run: the S22 flat `impound_records.daily_fee_cents` accrual
(`ImpoundFeeAccrualCron`) and this rate-card ledger. Both scan
`impound_records` daily. To prevent accidental double-billing in prod,
`STORAGE_AUTOBILLING_CRON_ENABLED` defaults **false** (the S22 cron is
untouched). Operators opt into exactly one model per environment.

## 9. Auto-billing requires a stall assignment

A vehicle accrues a `storage_charge` only while it is (a) a live, still-stored
impound record and (b) parked in a `yard_stall` — the stall identifies which
facility's rate card applies. Un-stalled stored vehicles are skipped. This is
the deliberate bridge between `impound_yards` and `yard_facilities`.

## 10. `webhook_deliveries` physical-table collision — **documented, NOT fixed**

`packages/db/src/schema/notifications.ts` and `webhook-deliveries.ts` both
declare a `pgTable('webhook_deliveries', …)` with different columns. This is a
pre-existing schema-design conflict (two modules, one physical name). Session
54 only disambiguated the **TypeScript export** name so the package compiles
(§0); the physical-table collision is left for the notifications/public-api
owners — out of yard scope.

## 11. Release wizard — single status-driven page (deviation from "each step its own URL")

The spec asked for each step at its own URL for retry/back-button safety. The
wizard is instead **one page driven off `workflow.status`** (the DB row is the
source of truth), so a reload/back always resumes at the true current step —
retry-safe by construction, with less route surface. The API steps ARE separate
idempotent POST endpoints, so a per-step-URL UI can be layered on later with no
backend change.

## 12. Migration number — `0051_yard_management.sql`

Highest on the branch base was `0050`. Per repo convention (migrate.ts
re-applies all idempotent `sql/*.sql` every run; gaps harmless) the
launch-assigned next number `0051` is used; contiguity is reconciled at merge if
a parallel session also took 0051.

## 13. Gate search — no case-number search (deferred)

`impound_records` has no case number; that identifier lives in the S23 lien
module. Gate search matches plate / VIN / in-flight-release payer name. Balance
owed = sum of `storage_charges` for the impound (the rate-card ledger; S22
`impound_fees` is a separate ledger and not included). Case-number search is a
documented follow-up.
