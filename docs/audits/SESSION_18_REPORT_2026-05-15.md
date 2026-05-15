# Session 18 — Towbook Import Repair

**Date:** 2026-05-15
**Engineer:** Claude Opus 4.7 (Senior Engineer mode)
**Base commit:** `dc41854`
**Head commit:** `690bc67`

## Summary

The Towbook import is fixed end-to-end. Five layered bugs were hiding
behind the single observed symptom (`status='failed'`): NestJS DI not
injecting `BundleService` into 9 of 10 importers, three importers
referencing columns that don't exist on their target tables, the synth
bundle generator producing duplicate phones and VINs, the build not
copying the `column-mappings/towbook.json` runtime asset into `dist/`,
and the test harness lacking `import_runs`/`import_run_events` cleanup.

Plus the three audit P0s the session was asked to close (R-01 import,
R-02 chat schema drift, R-03 Stripe placeholder) — and one P1 (R-04
dispatch drag-between-drivers) that the brief allowed in scope because
without it the "zero failing tests" success criterion was unreachable.

**API tests: 323/323 passing, 0 failing, 0 skipped.**
**E2E e2e-006: PASS. E2E e2e-008: PASS.**
**Deploy verdict: GO.**

## Commits landed this session

| Commit | Description |
|---|---|
| `5644f95` | `fix(api): add @Roles to all customer GET endpoints (P0 RBAC)` |
| `9fdfe84` | `fix(api): correct @Roles on GET /billing/invoices` |
| `2213d63` | `fix(test): repair RLS-bypass red-team — was silently skipped` |
| `af80b9e` | `fix(test): register application/zip parser in test bootstrap` |
| `37148b0` | `fix(api): drop broken WHERE tenant_id=$1 in reconciliation SQL` |
| `398568a` | `docs(runbooks): correct api.towcommand.com → api.towcommand.cloud` |
| `d5b3b03` | `fix(api): repair Towbook importers — DI, schema drift, missing keys` |
| `4e4f78d` | `fix(api): make synth bundle deterministic + per-test isolatable` |
| `0c41ee3` | `fix(test): repair chat suite — was silently skipped (R-02)` |
| `632d5a0` | `fix(api): validate Stripe publishable key format (R-03)` |
| `4937c41` | `fix(api): allow drag-between-drivers reassign on dispatched jobs (R-04)` |
| `cd6f3e9` | `fix(api): copy column-mappings JSON into dist on build` |
| `690bc67` | `fix(e2e): read fetch body once in e2e-006` |

## Towbook diagnosis findings

The audit's parser + SQL fixes unmasked the actual product bug, which
turned out to be five separate defects layered on top of each other.
Full diagnosis at `docs/audits/TOWBOOK_IMPORT_DIAGNOSIS_2026-05-15.md`.

### 1 — DI metadata missing on 9 of 10 importers

`BaseImporter` declares `constructor(protected readonly bundle:
BundleService)`. NestJS DI emits `design:paramtypes` metadata from the
**child** class being instantiated. When a child class extends a parent
with a constructor but declares no constructor of its own, the metadata
is empty and Nest instantiates the child with zero args — leaving the
inherited `bundle` field `undefined`.

`AttachmentImporter` was unaffected because it declared an explicit
constructor for `STORAGE_PROVIDER`. The other nine (Customer, Vehicle,
Driver, Truck, Job, Impound, Invoice, Payment, MotorClubHistory) all
silently lost their `BundleService` injection. The first phase
(customers) threw `Cannot read properties of undefined (reading
'buildRowGetter')` on the first row, the run was marked
`status='failed'`, and the transaction was rolled back. From the
outside this looked like a data-layer bug. It was DI.

Fix: added `constructor(bundle: BundleService) { super(bundle); }` to
each of the nine importers, with a `biome-ignore
lint/complexity/noUselessConstructor` comment so the lint rule (which
correctly identifies it as a no-op in pure TS) doesn't strip it.

### 2 — Importer SQL referenced non-existent columns

- `vehicle.importer` INSERT/UPDATE used `customer_id` and `notes`. The
  actual columns are `default_customer_id` and `special_instructions`.
- `vehicle.importer` `customer_vehicles` INSERT omitted the required
  `id` PK and the NOT NULL `updated_at` column.
- `driver.importer` INSERT/UPDATE referenced `terminated_at`. That
  column has never existed on `drivers`; `employment_status` already
  captures the terminated state.
- `job.importer` INSERT referenced `enroute_at`, `on_scene_at`,
  `in_progress_at`, `completed_at`. None of those columns exist on
  `jobs` — the lifecycle is captured in `job_status_transitions`.
- `job.importer` job-number allocator used `(tenant_id, day,
  last_seq)` against `job_number_sequences`; the actual column is
  `day_key`, and the ON CONFLICT update wasn't bumping `updated_at`.

Each of these caused the per-row SQL to throw, the savepoint to roll
back, and the importer to mark the row as errored. The integration
tests reported these as failed assertions on row counts.

### 3 — Synth bundle generator produced duplicates

The bundle generator used four-element pick-lists for phones (cycled
through `(310) 555-1234` etc.) and four-element VIN pick-lists. A
bundle of 5 customers had duplicate phones; a bundle of 5 vehicles had
duplicate VINs. The dedup-by-phone path correctly errored on the
duplicates (correct behavior for a real Towbook export with two real
customers sharing a phone), but the test bundle wasn't representing a
real Towbook export — it was supposed to be a clean idempotent fixture.

Fix: synth phones and VINs are now unique per `(idPrefix, kind, i)`.
Added an `idPrefix` option so multiple tests in the same suite (sharing
one tenant in `beforeAll`) don't collide on external_ids.

### 4 — Build didn't copy column-mappings JSON

`ImportRunService.loadMapping()` reads
`src/modules/import/column-mappings/towbook.json` relative to its own
`.js`. The build's `copy-assets.mjs` only copied email templates. A
production Railway deploy would `ENOENT` on the first import request.
The integration tests pass because they run the TypeScript source
in-process (the file is found via `import.meta.url` resolving to the
TS path). E2E-006 exposed this when it hit the built API.

Fix: extended `copy-assets.mjs` to mirror the column-mappings directory
into `dist/`.

### 5 — Test teardown missing import tables

`import_runs.tenant_id` has `ON DELETE RESTRICT`, so the final
`DELETE FROM tenants` in `helpers.ts:tearDown` failed with an FK
violation once the import tests actually persisted rows.
`import_run_events` cascades on `import_runs` but its own tenant_id
also has RESTRICT. Added explicit cleanup for both tables before the
tenant DELETE.

### 6 — Reconciliation drift comparator alias mismatch

The reconciliation `driftFields` for customers used `phone`, but the
bundle mapping's canonical field name is `phone_primary`. The bundle
lookup returned `null` and reconciliation reported every customer as
drifted.

Fix: drift fields now accept `string | { db, bundle }` so the DB column
name and the bundle's canonical name can differ when necessary.

## Senior-Engineer judgment calls documented

Per the brief's standing instruction to make calls within my expertise
rather than ask questions:

1. **Job lifecycle timestamps (enroute_at, on_scene_at, etc.) on
   import**: dropped from the import INSERT. The schema-of-record is
   `job_status_transitions`. Backfilling synthetic transitions for
   imported "completed" jobs is a future enhancement; for Phase 0,
   imported jobs land with their final status + `assigned_at` only.
   This is consistent with the audit's note that the import is a
   "one-time migration tool" rather than a real-time sync.

2. **R-04 dispatch reassign (in audit, not in original session scope)**:
   the brief required zero failing tests; R-04 was the only remaining
   failure after R-01/R-02/R-03 landed. The source comment ("Allow
   reassign while pre-enroute") and the test's explicit
   "drag-between-drivers" assertion made the product intent
   unambiguous, so I relaxed the 409 guard rather than amending the
   test. Stale-state protection should come from ETag/If-Match at the
   controller layer in a future session — flagged for the deploy
   readiness section.

3. **Synth bundle backwards compatibility**: `idPrefix` defaults to
   `'synth'` so the CLI smoke path (`pnpm exec tsx
   scripts/synth-towbook-bundle.ts`) produces identical output to
   before. Only tests opt in to per-test prefixes.

4. **Reconciliation drift field type**: introduced a `DriftField =
   string | { db, bundle }` union rather than a new structural type.
   String literals stay where DB and bundle field names already match;
   the structured form is only used for the one customer-phone case.
   Avoids touching every drift-field call site.

5. **Linting on the "useless" constructors**: added per-class
   `biome-ignore` comments rather than disabling the rule globally or
   refactoring `BaseImporter` to not require DI. The rule is correct
   for pure TypeScript classes — this is a NestJS DI quirk and the
   targeted ignore documents why the constructor exists.

## Test results

| Suite | Result |
|---|---|
| API unit + integration (`vitest run`) | **PASS** — 33 files, 323 tests, 0 failing, 0 skipped |
| Chat suite (was 12 silently-skipped) | **PASS** — 12/12 |
| Towbook import integration | **PASS** — 6/6 |
| Role-matrix | **PASS** — 4/4 |
| RLS cross-tenant red-team | **PASS** — 1/1 (now actually executes) |
| E2E `e2e-006-towbook-import` | **PASS** |
| E2E `e2e-008-driver-push-roundtrip` | **PASS** (sanity-only; R-07 push-token registration still stubbed but the mock-roundtrip test does not exercise that code path) |

## What remains for production deploy

All P0 blockers are closed. The remaining backlog from the Phase 0
audit is P1+ continuous-improvement work and **does not block launch**:

- **R-05 (P1)** — `AUDITOR` role wired into 2 endpoints; product
  decision needed on platform-wide read-only rollout.
- **R-06 (P1)** — Sentry on web. Client-side errors currently disappear.
- **R-07 (P1)** — Android `DriverFcmService.onNewToken()` still a stub.
  Drivers won't receive push until `/push/register` is wired.
- **R-08/R-09 (P1)** — RTO/RPO numbers and rollback docs.
- **R-10..R-16 (P2/P3)** — Hardcoded URNs, QBO env-vars, web CSP,
  web unit tests, hardcoded localhost fallbacks, Android staging
  variant, dual-migration docs.
- **New (this session)** — ETag/If-Match on `/dispatch/jobs/:id/assign`
  for stale-state concurrency protection. Replaces the over-strict
  409 guard removed in R-04.

## Deploy readiness verdict

**GO.** All P0 import / chat / payments blockers are closed. The API
test suite is fully green with zero silent skips. The Towbook import
runs end-to-end against the built production artifact (E2E-006
verifies). The dispatcher's drag-between-drivers UX works (R-04). The
Stripe `publicKeyConfigured` flag no longer lies about placeholder
keys (R-03). The chat suite is once again testing tenant isolation
instead of silently skipping (R-02). Schedule the production deploy.
