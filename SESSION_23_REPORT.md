# Session 23 Report — Lien Processing

## TL;DR

Shipped the statutory lien-sale workflow for unclaimed impounded vehicles
across the **top 10 states** (CA, TX, FL, NY, GA, NC, OH, IL, PA, MI): a pure,
fully-unit-tested rule engine; a NestJS module (service + controller + env-gated
observation-only cron); shared Zod contracts; a web UI (list / detail / open /
notice form); and state-form PDF rendering. Every legal step is an explicit
operator action — the system never auto-advances or auto-sells. Statute
day-counts are best-effort and flagged for counsel review (see
`SESSION_23_DECISIONS.md`).

Verification: workspace typecheck ✅ · 398 API tests pass (95 new lien
assertions) ✅ · web tests pass (1 pre-existing unrelated failure) ✅ ·
shared/db/api/web builds ✅ · biome clean on changed files ✅.

## What shipped (✅)

- **DB** — `0037_lien_processing.sql` + 4 Drizzle schema files:
  `lien_cases`, `lien_notices`, `lien_timeline_events` (FORCE RLS, audit
  triggers, cross-tenant consistency triggers, soft delete) and
  `lien_state_rules` (global reference, seeded for all 10 states). Idempotency:
  one live case per impound record; one pending notice per (case, type,
  recipient).
- **Rule engine** (pure) — `lien-rules.logic.ts` + `state-rules.config.ts`.
  `computeNextAction(facts, rules, today) → { action, dueAt, blocking, reasons }`,
  `computeEarliestSaleDate`, `computeValueTier`, `isPublicationRequired`. Per-
  state config with statute citations.
- **API** — `LienProcessingService` (openCase, advanceCase, recordNotice,
  recordResponse, closeCase + listCases / getCaseDetail / updateCase /
  listStateRules / getCaseForForm); `LienProcessingController` (`/lien-cases`,
  tenant-scoped `RolesGuard`); `LienAdvanceCron` (env-gated `0 3 * * *`,
  observation-only). Wired into `app.module.ts`; `LIEN_ADVANCE_CRON_ENABLED`
  added to `config.schema.ts`. Inline data access (no repository).
- **Shared contracts** — `packages/shared/src/lien-processing/` (state-rules,
  cases, notices, timeline, forms, detail) + barrel export.
- **PDF** — single `LienFormPdfService` renders owner-notice + publication-notice
  for all 10 states (20 logical templates) from the per-state config;
  `GET /lien-cases/:id/forms/:formType → application/pdf`.
- **Web** — `/lien-cases` (list w/ state/status/due filters), `/lien-cases/[id]`
  (timeline, notices, next-action panel, advance/notice/response/close actions,
  PDF links), `/lien-cases/new` (open from a lien-eligible impound record);
  BFF routes (root + catch-all + binary PDF); `Lien Cases` sidebar entry.
- **Tests** — 10 per-state engine specs (75 assertions); PDF smoke (20); lien
  RLS spec (cross-tenant on all 3 tenant tables); integration spec (open →
  advance → ready-for-sale on CA/TX/FL + cron observation-only); web ui-helper
  spec (4).

## Decision log

See `SESSION_23_DECISIONS.md` for the full rationale. Headlines: best-effort
statutes (counsel review required); observation-only cron; one PDF renderer +
per-state config (not 20 files); open-case reads the impound API read-only (no
impound files touched); English legal docs with a bilingual redemption line.

## Deferred (🟡)

- Remaining 40 states (S35); official fillable state forms; DMV lookup API
  integration; tenant-level rule overrides; sale-proceeds accounting. Full list
  in the decisions doc.

## What was NOT touched

- Impound module (API, schema, web), motor-club / police-rotation / Plate-to-VIN
  code, `auth/`, shared contracts outside `lien-processing/`,
  `scripts/check-migrations.sh`.

## Test coverage

- `apps/api/src/modules/lien-processing/lien-rules.{ca,tx,fl,ny,ga,nc,oh,il,pa,mi}.spec.ts`
  — 75 assertions (value tiers, DMV/notice ordering, publication rules,
  waiting-period math, ready-for-sale gate, claim blocking).
- `forms/lien-form.renderer.spec.ts` — 20 (every state × form type renders a PDF).
- `apps/api/test/lien-processing-rls.spec.ts` — cross-tenant isolation + FK
  consistency + pending-notice unique (DB-gated).
- `apps/api/test/integration/lien-processing.spec.ts` — full lifecycle on
  CA/TX/FL + duplicate-open + sale gate + observation-only cron (DB-gated).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres; they
  run in the docker/CI DB path (mirrors every other module's RLS/integration
  specs).
- `apps/web` `offline-queue.spec.ts` fails locally (pre-existing
  `window.location`/env gap, driver code, not in CI) — not a regression from
  this session.
- Statute day-counts are best-effort and require legal review before production
  lien sales (loud disclaimer in the decisions doc + code).

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 398 pass (95 lien); DB specs skip
pnpm -F web test                            # lien helper spec passes
pnpm -F @ustowdispatch/shared -F @ustowdispatch/db -F @ustowdispatch/api run build
pnpm -F web run build
# enable the cron in prod: LIEN_ADVANCE_CRON_ENABLED=true
```
