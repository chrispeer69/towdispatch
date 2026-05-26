# Session 37 — Full DOT Compliance: Decisions Log

**Scope:** FMCSA / DOT recordkeeping & reporting for commercial carriers —
carrier profile, driver-qualification (DQ) files, hours-of-service (HOS)
logs, drug & alcohol program records, incident/accident register, and a
combined audit-packet PDF. Pure recordkeeping; **no live ELD integration**
this session.

---

## ⚠️ Compliance disclaimer (read first)

The HOS day-counts, the DQ-completeness rules, and the "DOT-recordable"
derivation encode the **property-carrying** FMCSA rules (49 CFR Part 395 /
391 / 382 / 390) to the best of available knowledge. They are an
operational aid, **not legal advice**, and have not been certified against
the current CFR. A carrier's compliance officer should review before
relying on these outputs for an audit response. Every rule constant carries
its CFR citation in `hos-rules.logic.ts` / `dq-file.logic.ts`.

---

## Reuse over duplication — the two big calls

### 1. DVIR is reused, not rebuilt (no `dot_dvir` table)

A complete DVIR system-of-record already exists on master from the
driver-app sessions: the `dvirs` table (`packages/db/src/schema/dvirs.ts`),
`FleetDvirsService` (`apps/api/src/modules/fleet/dvirs.service.ts`), and the
web entry page (`apps/web/.../fleet/dvirs`). It already carries
pre_trip/post_trip, a `defects` jsonb array, and the `out_of_service`
roll-up.

Creating `dot_dvir` would mean two systems of record for the same event —
operators recording twice, or sync logic. **Decision:** the DOT module does
not create `dot_dvir` and does not add a DVIR write path. Instead:
- the audit packet's DVIR section and the "open DVIR defects" report **read**
  the existing `dvirs` table;
- the DOT web links DVIR entry to the existing `/fleet/dvirs` page;
- `DotService` exposes `openDvirReport()` (read) — there is no
  `DotService.recordDvir` (the spec's `recordDvir` is satisfied by the fleet
  endpoint).

This deviates from the literal deliverable (which listed `dot_dvir` and a
`recordDvir`); the spec predates / wasn't aware of the parallel-session
`dvirs` table now on master. Documented loudly here per the reuse rule.

### 2. DQ file is an EXTENSION of `drivers`, not a copy

The `drivers` table already carries `cdl_class`, `license_number`,
`license_state`, `license_expires_at`, `medical_card_expires_at`,
`drug_test_last_at`, `road_test_completed_at`, `certifications`. The DOT
deliverable's `dot_driver_qualifications` listed several of these again.

**Decision:** `dot_driver_qualifications` holds **only** the DQ-file fields
`drivers` lacks — `dq_file_status`, `employment_app_signed_at`,
`mvr_pulled_at`, `mvr_expires_at` — keyed 1:1 to `drivers` (partial-unique
on `driver_id`). License / medical-card / drug-test / road-test dates stay
on `drivers` (single source of truth). The pure `dqFileStatus(driver, ext,
today)` reads both rows. No duplicated, drift-prone date columns. (The
`audit_log` triggers + soft delete already give the immutable legal trail —
snapshotting into a second table would add drift, not legal weight.)

---

## Other decisions

- **HOS ruleset: property-carrying** (not passenger). 11h driving / 14h duty
  window / 30-min break after 8h driving / 60h-7d + 70h-8d rolling cycles
  (49 CFR 395.3). Encoded as a typed `HOS_LIMITS` config so each rule is
  independently citable and unit-testable. The 11h/14h/30-min rules are
  evaluated **per duty period** (a period resets after ≥10h off duty); the
  cycle rules roll across the whole window. Cycle rules emit a **warning** at
  ≥90 % of the limit and a **violation** above it — the only use of the
  `warning` severity this session.
- **Manual HOS entry — no ELD.** Each duty-status segment is entered by
  hand; the validator works on segments and ignores open (no-`end_at`) ones.
  ELD vendor integration (KeepTruckin / Samsara) is explicitly out of scope.
- **Drug & alcohol: log-only.** Records test type / result / lab / doc key;
  no consortium / C-TPA integration.
- **Audit packet: one combined PDF**, not per-document downloads — an FMCSA
  review wants a single packet. Six sections (carrier, DQ roster, HOS w/
  violations, DVIR, drug & alcohol, incidents). The section **model**
  (`buildAuditPacketSections`) is separated from PDF drawing so it is
  unit-testable without parsing the compressed PDF stream (the smoke test
  asserts the 6 sections + the tenant USDOT on the model, and valid `%PDF`
  bytes on the render). **English-only** legal filing language — mirrors the
  lien-session decision (a deliberate exception to the Spanish-parity rule).
- **`dot_carrier_profile` uses `id` PK + partial-unique `tenant_id`**, not
  `tenant_id`-as-PK as the spec phrased it. `fn_audit_log()` records
  `resource_id := NEW.id`; keeping an `id` column gives a meaningful audit
  trail and matches every other table's shape. One live profile per tenant
  is still enforced (partial-unique index).
- **Expiry cron is observation-only.** `DOT_EXPIRY_CRON_ENABLED` (default
  **false**, daily 06:00 — after impound 02:00 / lien 03:00). It scans every
  tenant's drivers for medical-card / license / MVR items expiring within 60
  days and **logs** a structured alert per item. It never mutates driver or
  DQ data. Wiring those alerts to a notification channel (email / in-app) is
  deferred — keeps the cron self-contained and free of a notifications-table
  dependency.
- **`dot_reportable` auto-derivation.** When the operator omits it, the
  service derives it: fatality OR injury OR vehicle towed away (the FMCSA
  recordable-accident test, 49 CFR 390.5). The operator may override.
- **RBAC:** OWNER / ADMIN / MANAGER write; + AUDITOR read. DISPATCHER /
  ACCOUNTING / DRIVER have no access. DOT compliance is a back-office /
  safety-manager function, so MANAGER (not DISPATCHER) gets write — diverges
  from the impound READ/WRITE sets deliberately.
- **Migration numbering: 0040.** 0038 (lien, Session 23) and 0039
  (heavy-duty, Session 36) live on parallel feature branches not yet on
  master; 0040 reserves room and avoids a duplicate number when they merge.
  The migrate runner applies SQL lexicographically and 0040 only depends on
  tables already on master (tenants, users, drivers, trucks, jobs), so the
  0038/0039 gap is safe. `scripts/check-migrations.sh` enforces contiguous
  numbering but master already violates it (pre-existing duplicate `0034_*`
  and `0036_*` files) and it is not a CI gate (only `e2e.yml` runs) — left
  untouched, mirroring the lien-session decision.

---

## Deferred (🟡)

- **ELD integration** (KeepTruckin / Samsara / etc.) — partner clock,
  parked. HOS is manual this session.
- **IFTA / IRP filing** — out of scope (the `trucks` table already carries
  `ifta_license` / `irp_account` columns for a future module).
- **S36 heavy-duty cert cross-reference** — the Session 36 heavy-duty tables
  are not on master, so the DVIR/DQ cross-reference to heavy-duty
  certification could not be wired. Deferred until S36 merges.
- **Notification delivery for expiry alerts** — the cron logs; routing to
  email / in-app is a follow-up.
- **DVIR repair-close tracking** — `dvirs` has no "defect resolved" flag, so
  "open" = any DVIR with status ≠ `no_defects`. A repair-closed workflow
  belongs to the fleet module.
- **Random-testing selection pool / rates** — the drug & alcohol log records
  results; managing the random pool and computing program rates is future.
