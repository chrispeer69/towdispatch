# Session 36 — Heavy-Duty Specialist: Decisions Log

**Scope:** An HD-aware layer (Class 7/8 + commercial recovery) on top of the
existing truck / driver / job entities — capabilities, certifications, job
attributes, rate sheets, dispatch-eligibility filters, an on-scene estimate
generator, an env-gated cert-expiry cron, a web surface, and three reports.
**Not a fork:** every HD table hangs off a pre-existing parent or is tenant
reference data.

---

## Architecture / data model

- **HD as job *attribute*, not a separate job entity.** `hd_job_attributes`
  has a 1:1 (one live row per job) FK to `jobs` with `ON DELETE CASCADE`. The
  jobs module/schema is untouched (DO-NOT honored). Rationale: HD is a facet of
  an existing tow/recovery job, not a different object — a separate entity would
  duplicate customer/vehicle/dispatch linkage and force a join on every read.

- **`trucks.heavy_duty_capable` stays the dispatch hot-path flag;
  `hd_truck_capabilities` is the authoritative rich detail.** Eligibility
  filters on the capability row (GVWR class, rotator, rated recovery weight).
  `setTruckCapabilities` flips `trucks.heavy_duty_capable = true` (a
  tenant-scoped `UPDATE`, only ever sets true, never clears) so the existing
  roster hot path stays honest. This is a cross-module *write* but **no
  trucks-module code or schema change** — the alternative (making the flag a
  DB-derived column) would have touched the trucks module.

- **Rate sheet, not per-job custom pricing.** `hd_rate_sheets` holds reusable
  cents-per-unit cards; the on-scene estimate generator prices a job against a
  named sheet and persists the total to `hd_job_attributes.on_scene_estimate_cents`.
  Per-job override is still available — the estimate inputs (hours/miles/flags)
  are per-call, so the same sheet yields different tickets — without storing a
  bespoke price table per job. `final_invoice_cents` is a separate finalize
  step so the estimate→final delta is auditable.

- **One live cert per `(driver, cert_type)`** (partial unique index). Recording
  a renewal supersedes the prior live row (the service upserts). A full cert
  *history* table was out of scope; eligibility only ever needs the current
  credential.

- **`gvwr_class` (categorical 3–8) AND `vehicle_gvwr_lbs` (raw) both kept**, not
  one DB-derived from the other. A `gvwrLbsToClass()` helper (FMCSA brackets:
  Class 7 = 26,001–33,000 lb, Class 8 = >33,000 lb) reconciles them in the
  eligibility logic. Operators capture whichever they know on scene.

- **`hd_rate_sheets` has no cross-tenant consistency trigger** — it has no
  secondary parent, so the `tenant_id` FK + the FORCE-RLS policy are the
  isolation guarantee. The three child tables (truck/driver/job) each get a
  BEFORE-trigger that verifies the parent's tenant matches (RLS hides foreign
  parents, so a foreign id surfaces as "does not exist"). Mirrors
  `0036_impound_storage.sql`.

## Eligibility logic

- **Hazmat is a DRIVER certification, not a truck attribute.** The task lists
  hazmat under the truck filter, but `hd_truck_capabilities` has no hazmat
  column and hazmat is an operator endorsement. So `requiresHazmat` gates the
  *driver* pool (requires a non-expired `hazmat` cert), not the truck pool.
  Documented here as a deliberate, schema-consistent reading.

- **CDL required for Class 7+ or hazmat jobs.** `eligibleDriversForHdJob`
  requires a live `cdl_a` OR `cdl_b` when the effective job class ≥ 7 or the job
  is hazmat. Missing vs expired CDL are reported distinctly.

- **A cert expiring *exactly today* is still valid** (expires end-of-day); a
  null expiry never expires. `certStatus()` classifies valid / expiring (≤
  window) / expired and is shared by the roster report and the cron.

- **Eligibility helpers are pure and read-only.** They never touch dispatch
  core — the service loads candidate trucks/drivers and feeds the pure
  functions. Candidate trucks = the HD fleet (`heavy_duty_capable` or has a
  capability row); candidate drivers = those holding ≥1 HD cert. Results are
  returned eligible-first with human-readable `reasons` for every ineligible
  row.

## Pricing

- **Multipliers do NOT stack — the higher applicable premium wins.** A holiday
  call worked after-hours bills at the holiday rate, not holiday × after-hours.
  Conservative + predictable + unit-tested. `multiplier = max(1, applicable…)`,
  `total = round(subtotal × multiplier)`, each line `round(qty × unitCents)`.
  Multipliers stored as `numeric(4,2)` in `[1, 10]`; the service parses the
  string to a number at the boundary.

## Cert-expiry cron — observation-only

- `HD_CERT_EXPIRY_CRON_ENABLED` (default **false**), `0 4 * * *`. The cron is
  **observation-only**: it scans live certs, classifies against a 30-day
  window, and logs the expiring/expired set (tenant + cert id + driver id +
  days remaining — **no PII such as names**), returning a count result. It
  NEVER mutates a cert, deactivates a driver, or sends a notification. The
  operator-facing durable surface is the cert-expiry roster report. Mirrors the
  lien-advance cron's conservative posture. **Deferred:** wiring to
  `NotificationModule` (SMS/email alerts).

## Reports — HD-module endpoints, not the central reporting registry

- The three reports (HD jobs by month, cert-expiry roster, equipment
  utilization) are served by `GET /heavy-duty/reports/*` on the HD controller,
  computed in `HeavyDutyService`. The central reporting module
  (`reporting.service.ts`) uses a constructor-injected `Reporter` registry keyed
  by a `ReportId` enum in shared + per-report RBAC narrowing; wiring HD reports
  in would mean editing the reporting module, its shared `ReportId` contract,
  and its RBAC table — cross-module coupling for no functional gain. Keeping
  them self-contained keeps the HD module shippable in isolation. **Deferred:**
  promoting them into the central registry (export/scheduling/caching) is a
  future session.

## Web

- **Path is `apps/web/src/app/(app)/heavy-duty/`**, not the task's literal
  `apps/web/app/heavy-duty/`. Rule 9 (mirror existing patterns): every page in
  this app lives under `src/app/(app)/`. BFF is a single catch-all
  `app/api/heavy-duty/[...path]/route.ts` proxy (mirrors impound). Sidebar entry
  added under Operations after Trucks/Drivers.
- Truck-capability and driver-cert pickers read the tenant fleet via the
  existing `/fleet/trucks` + `/fleet/drivers` server fetchers (read-only) — no
  fleet-module change.

## Migration numbering

- `0039_heavy_duty.sql`. Master is at `0037`; `0038_lien_processing.sql` is on
  the Session-23 branch (PR open, not yet merged). The migrate runner applies
  files in lexicographic order and `0039` only depends on pre-existing parents
  (trucks, drivers, jobs, tenants, users), so the temporary gap at `0038` is
  harmless (master already carries duplicate numbers at `0034`/`0036`).

## Deferred (🟡)

- **DOT report rendering** — `requires_dot_report` is captured; the document
  itself is **Session 37** (per DO-NOT).
- **Hazmat-specific compliance reporting** — Session 37 (per DO-NOT).
- **Telematics integration** (live truck location/weight feeds) and **dynamic
  GVWR lookup** (VIN → GVWR via a DMV/decoder API) — future.
- **Cert-expiry → NotificationModule** alerts (cron is observation-only today).
- **HD reports into the central reporting registry** (export/scheduling).
- **Linking the finalized HD invoice into the billing module** — `final_invoice_cents`
  is recorded on the attribute row; AR/invoice linkage is out of scope.
