# Session 48 — EV-Specific Recovery Workflows: Decisions Log

**Scope:** An EV-aware recovery layer over the existing dispatch (jobs) module:
charge-state intake, OEM tow procedures, conservative flatbed-only equipment
rules, battery thermal-event escalation, and charge-stop logging — plus an
operator console surface, a driver-app surface, and a reporting view. No
dispatch-core file was modified.

---

## ⚠️ SAFETY DISCLAIMER (read first)

The per-OEM `tow_mode_steps` / `hv_disconnect_steps` seeded into
`ev_oem_procedures`, and the per-model wheels-down allowances in
`ev-tow-profiles.config.ts`, are **best-effort summaries of public OEM towing
guidance. They are NOT a substitute for the current OEM service manual or
first-responder guide.** Every seed row carries `last_verified_at`; the UI
shows a "verify against the OEM manual" disclaimer. The equipment engine
defaults **UNKNOWN EVs to flatbed-only**, and a known model only earns a
wheels-down allowance when the move is confirmed short AND the pack is not
critically low. Verify against the manufacturer before a tech relies on any
wheels-down allowance in the field.

---

## Migration numbering — 0042

Master tops out at `0037_reporting.sql`. The launch spec named `0042`, and the
parallel feature worktrees (lien=0038, heavy-duty, dot-compliance, auction,
white-label, public-api, …) are claiming 0038-0041. Holding the gap at **0042**
is the conservative call — it avoids a duplicate number with a sibling session.
The migrate runner applies `./sql/*.sql` in lexicographic order on every run
(no tracking table), and `0042` only depends on pre-existing tables (`jobs`,
`tenants`, `users`), so ordering after the gap is safe. `scripts/check-migrations.sh`
was **not** touched.

## `ev_oem_procedures` — global reference data, surrogate PK

- **No tenant_id, no RLS** — OEM procedure is identical for every operator, so
  it mirrors `lien_state_rules`: `app_user` reads it via the default-privilege
  SELECT grant. The RLS spec confirms both tenants see the same rows.
- **PK is a surrogate `uuid`, not `make`.** The launch named `make` as the PK,
  but a make has many models (Tesla ships 5) and `model` is nullable, so a
  single-/composite-PK on those columns cannot hold. We use a surrogate `uuid`
  PK + a unique index on `(lower(make), lower(coalesce(model,'')), coalesce(model_year_from,0))`.
- **Seed via DELETE-by-make + INSERT, not `ON CONFLICT`.** Because the runner
  re-applies the file every migrate, the seed must be re-runnable. We DELETE the
  seeded makes then INSERT — avoiding a fragile `ON CONFLICT` inference against
  the expression unique index. Seed UUIDs use `gen_random_uuid()` (pgcrypto,
  enabled in 0001) — the same house pattern `0022_service_catalog.sql` uses for
  reference seeds. (The "UUIDv7 only" invariant governs app-generated entity
  IDs via `uuidv7()`; reference-seed rows follow the established `gen_random_uuid`
  precedent.)

## Cross-tenant consistency triggers

All three job-linked tables (`ev_job_attributes`, `ev_thermal_events`,
`ev_charge_station_visits`) carry a BEFORE INSERT/UPDATE trigger
(`fn_ev_job_tenant_consistency`) verifying the referenced job's `tenant_id`
matches the row's `tenant_id`. RLS hides foreign jobs from the trigger's
SELECT, so a cross-tenant `job_id` surfaces as "does not exist" — mirrors the
lien module's pattern. `ev_job_attributes` is also 1:1 per job (partial unique
on `job_id WHERE deleted_at IS NULL`).

## Equipment rules — conservative defaults

`requiredEquipmentForEv` (pure):
- **Unknown make/model → flatbed only.** No dollies, no wheel-lift.
- **Tesla / Rivian / Ford / Lucid / Hyundai / Kia / VW → flatbed only** per OEM
  guidance (rolling drive wheels back-feeds the motor / drive unit).
- **Bolt EV/EUV (FWD) maxWheelDownMiles 5, Leaf (FWD) 3** — a short reposition
  with the drive wheels OFF the ground is tolerated; flatbed for anything
  longer or of unknown distance.
- **Low SOC (≤5%) overrides any allowance → flatbed.** A starved pack may not
  engage Transport/Neutral mode.
- Distance comes from `jobs.intow_miles` (pickup→dropoff); null distance is
  treated as unknown → flatbed (conservative).
- A recorded thermal event sets `hvIsolationRequired`.

## Thermal-event escalation matrix (conservative, fixed)

`thermalEventEscalation(severity)`:

| severity  | fire dept | hazmat | evacuate | scene lockdown |
|-----------|:---------:|:------:|:--------:|:--------------:|
| odor      |     —     |   —    |    —     |       —        |
| swelling  |     ✓     |   —    |    —     |       ✓        |
| smoke     |     ✓     |   ✓    |    ✓     |       ✓        |
| venting   |     ✓     |   ✓    |    ✓     |       ✓        |
| sparking  |     ✓     |   ✓    |    ✓     |       ✓        |
| flames    |     ✓     |   ✓    |    ✓     |       ✓        |

odor = monitor only (earliest sign); swelling = notify + secure (slower-
developing cell failure); smoke and anything more energetic = full response.
No heuristics — a fixed lookup so it's fully unit-tested.

## Driver surface — dedicated controller, not a relaxed operator guard

`/driver-ev/*` is a separate `@Public() @UseGuards(DriverAuthGuard)` controller
(mirrors `DriverJobsController`, Session 3) rather than adding `DRIVER` to the
operator `RolesGuard` — keeps the auth blast radius small. Driver-originated
writes set `created_by = NULL` (a driverId is not a `users.id`); the audit
actor is the driverId via `app.current_user_id`, matching the existing
driver-experience write pattern. The shared `EvRecoveryService` serves both
controllers; the caller ctx carries `createdBy` (operator user id vs null).

## One ReportId folds the three report asks

The reporting framework is one `Reporter` per `ReportId` (KPIs / timeSeries /
breakdown / rows). The three launch reports map onto a single **`ev-recovery`**
report: timeSeries = EV jobs by month, breakdown = thermal events by severity,
rows = charge stops with cost + who-pays, KPIs = totals + reimbursable cost
(charges `paid_by` customer/club). Cleaner than three new ids and consistent
with the framework. Added to `reportIdValues`, `reportTitles`,
`reportShortDescriptions`, `REPORT_ROLES`, and the web `DIMENSIONS` map.

## i18n — English console, bilingual safety line only

The operator console has no i18n framework (every existing screen is
English-only). Per Rule 9 (mirror), EV operator labels stay English. The one
exception is the **thermal-event safety warning**, surfaced bilingually (EN/ES)
on both the operator and driver views so a non-English customer/bystander being
evacuated understands it — the same spirit as the lien module's bilingual
redemption line. `bilingualThermalWarning()` is unit-tested.

## `EV_RECOVERY_ENABLED` config flag

Added to `config.schema.ts` (default `true`). No cron this session. It is an
ops kill-switch **placeholder** — the module is always wired; the flag is
reserved so ops can disable the surface without a redeploy if a data issue
surfaces. Not yet enforced (documented here so it isn't mistaken for dead code).

## Numeric storage

`battery_kwh` / `kwh_delivered` are `numeric` columns — drizzle returns them as
strings (house convention, to avoid float drift). The service converts to
`number` at the DTO boundary (`num()` helper) and back to string on insert.
`cost_cents` is integer cents.

## Deferred (🟡)

- **OEM-direct API integrations** (live tow-mode / recall data) — partner clock
  parked per the DO-NOT list.
- **Automated OEM procedure updates** — `ev_oem_procedures` is seeded + manually
  maintained; `last_verified_at` flags staleness.
- **Customer-facing EV safety brief** (a shareable customer doc) — deferred.
- **Battery-fire suppression product recommendations** — deferred per DO-NOT.
- **Equipment distance hinting in the UI** — the engine reads `jobs.intow_miles`;
  an operator override field on the EV panel is a follow-up.
- **DB-gated specs (RLS + integration)** self-skip locally without Postgres;
  they run in the docker/CI DB path (mirrors every other module).
