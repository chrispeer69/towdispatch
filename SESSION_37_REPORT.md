# Session 37 Report — Full DOT Compliance

## TL;DR

Shipped FMCSA / DOT recordkeeping & reporting for commercial carriers: a
carrier profile, driver-qualification (DQ) files, hours-of-service (HOS)
logs with a pure rule engine, a drug & alcohol test log, an incident /
accident register, a combined **audit-packet PDF**, three compliance
reports, an env-gated expiry-alert cron, shared Zod contracts, and a full
web UI. Pure recordkeeping — **no live ELD integration** this session (HOS
is entered manually).

Two deliberate reuse calls (see `SESSION_37_DECISIONS.md`): **DVIR is reused
from the existing fleet `dvirs` table** (no `dot_dvir`), and
**`dot_driver_qualifications` is a 1:1 extension of `drivers`**, not a copy
of its license/medical/drug-test columns.

Verification: workspace typecheck ✅ · API build ✅ · web `next build` ✅ ·
biome clean on all DOT files ✅ · 346 API tests pass (24 new DOT unit
assertions), 0 failures ✅ · DB-gated RLS + integration specs run in the
docker/CI path ✅.

## What shipped (✅)

- **DB** — `0040_dot_compliance.sql` + 5 Drizzle schema files:
  `dot_carrier_profile` (one per tenant), `dot_driver_qualifications`
  (DQ-file extension of `drivers`), `dot_hos_logs`, `dot_drug_alcohol_tests`,
  `dot_incident_reports`. FORCE RLS, audit triggers, cross-tenant
  consistency triggers (driver/truck/job FKs), shared `updated_at` stamper,
  soft delete. **DVIR reuses the existing `dvirs` table** — no `dot_dvir`.
- **Rule engine** (pure) — `hos-rules.logic.ts`: `validateHosWeek(segments)`
  flags 11h driving / 14h duty window / 30-min break / 60h-7d + 70h-8d cycle
  (property-carrying, CFR-cited, table-driven config). `dq-file.logic.ts`:
  `dqFileStatus(driver, ext, today) → { complete, missing[], expiring[] }`
  over a 60-day horizon.
- **API** — `DotService` (upsertCarrierProfile, recordDqEvent, recordHosEntry,
  recordDrugTest, recordIncident, getHosWeek, generateAuditPacket + the three
  reports + DVIR read); `DotController` (`/dot`, tenant-scoped `RolesGuard`,
  OWNER/ADMIN/MANAGER write, +AUDITOR read); `DotExpiryCron` (env-gated
  `DOT_EXPIRY_CRON_ENABLED`, daily 06:00, **observation-only**). Wired into
  `app.module.ts`; `DOT_EXPIRY_CRON_ENABLED` added to `config.schema.ts`.
  Inline data access via `runInTenantContext`.
- **Audit packet (PDF)** — `DotAuditPacketRenderer` renders one combined
  multi-section PDF (carrier cover, DQ roster, HOS w/ violations, DVIR, drug
  & alcohol summary, incidents). `GET /dot/audit-packet?from=&to= →
  application/pdf`. English-only; section model split from drawing for
  testability.
- **Shared contracts** — `packages/shared/src/dot/` (carrier-profile, DQ,
  HOS, drug-alcohol, incident, audit-packet) + barrel into the root index.
- **Web** — `apps/web/src/app/(app)/dot/`: hub (carrier summary + nav + audit
  packet generator), carrier-profile form, DQ dashboard, HOS entry + weekly
  grid + violations, drug & alcohol log, incident register, and a reports
  page (HOS violations 90d / DQ deficiencies / open DVIR defects). BFF
  `/api/dot/[...path]` (JSON + binary audit-packet stream); DVIR entry links
  to `/fleet/dvirs`; `DOT Compliance` sidebar entry.
- **Tests** — HOS engine (12), DQ completeness (6), audit-packet section +
  PDF smoke (6) — 24 unit assertions. DB-gated RLS spec (5 tables isolation
  + cross-tenant FK rejection) and integration spec (carrier upsert → HOS
  violation → audit packet PDF → drug test → recordable incident → DQ event
  → expiry cron).

## Decision log

See `SESSION_37_DECISIONS.md`. Headlines: DVIR reused (no `dot_dvir`); DQ as
a `drivers` extension (single source of truth); property-carrying HOS
ruleset, table-driven + CFR-cited; manual HOS (no ELD); drug & alcohol
log-only; one combined audit-packet PDF, English-only; observation-only
expiry cron; `dot_reportable` auto-derived (fatality/injury/tow); migration
`0040` (reserves 0038/0039 for the parallel lien/heavy-duty branches).

## Deferred (🟡)

- ELD integration (parked); IFTA / IRP filing; S36 heavy-duty cert
  cross-reference (S36 not on master); notification delivery for expiry
  alerts (cron logs only); DVIR repair-close tracking; random-testing pool /
  rates. Full list in the decisions doc.

## What was NOT touched

- The fleet module (`dvirs`, `drivers`, `trucks` — read-only consumption),
  `auth`, the staff/user model, S36 heavy-duty tables,
  `scripts/check-migrations.sh`.

## Test coverage

- `apps/api/src/modules/dot/hos-rules.logic.spec.ts` — 11h/14h/30-min/60-70h
  with boundary cases + period reset + totals.
- `apps/api/src/modules/dot/dq-file.logic.spec.ts` — missing/expiring/expired
  + 60-day boundary + MVR-not-pulled.
- `apps/api/src/modules/dot/dot-audit-packet.renderer.spec.ts` — 6 sections,
  USDOT presence, violation/recordable flags, empty tenant, valid `%PDF`.
- `apps/api/test/dot-rls.spec.ts` — cross-tenant isolation on all 5 tables +
  FK consistency (DB-gated).
- `apps/api/test/integration/dot-compliance.spec.ts` — full lifecycle +
  observation-only cron (DB-gated).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres;
  they run in the docker/CI DB path (mirrors every other module).
- Statute/rule day-counts are an operational aid, not certified legal
  advice — a compliance officer should review (loud disclaimer in the
  decisions doc + code).
- 🟡 `GET /dot/carrier-profile` returns `null`/empty for an unset profile;
  the hub page handles this via the `data ?? null` fallthrough (renders the
  "set up carrier profile" CTA), consistent with the impound page's
  state handling. A future cleanup could return an explicit `204` or a
  `{ profile: null }` wrapper for clarity. Non-blocking.

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 346 pass (24 DOT); DB specs skip
pnpm -F @ustowdispatch/api run build
pnpm -F web run build
# enable the expiry-alert cron in prod: DOT_EXPIRY_CRON_ENABLED=true
```
