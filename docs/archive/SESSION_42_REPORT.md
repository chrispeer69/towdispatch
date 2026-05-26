# Session 42 Report — Photo Damage Analysis

## TL;DR

Shipped AI-vision damage analysis over pre-tow / post-tow evidence photos to
defend against fraudulent damage claims: a **pluggable vision provider**
(stub | anthropic | openai, default stub, no new deps), a **pure pre/post
comparison engine** (new vs pre-existing vs inconclusive), a NestJS module
(service + controller + env-gated retry worker), shared Zod contracts, a
**bilingual PDF damage report**, and a **web UI** on the job detail (trigger,
operator override, side-by-side comparison, PDF download). Every analysis is
an explicit operator action — nothing auto-triggers. PII (VIN/plate/owner) is
never sent to a third-party model.

Verification: workspace typecheck ✅ · 356 API tests pass (34 new damage
assertions) ✅ · biome clean on changed files ✅ · shared/db/api/web builds ✅.

## What shipped (✅)

- **DB** — `0041_damage_analysis.sql` + 3 Drizzle schema files:
  `damage_analyses`, `damage_findings`, `damage_comparisons` (FORCE RLS,
  audit triggers, updated_at triggers, cross-tenant consistency triggers,
  soft delete, CHECK enums). Idempotency: one live comparison per
  `(job, pre, post)` triple.
- **Provider abstraction** — `DamageProvider` contract + DI token; factory
  selects stub | anthropic | openai from `DAMAGE_ANALYSIS_PROVIDER` and
  refuses to boot in a live mode with no key. `StubDamageProvider`
  (deterministic, offline); `Anthropic`/`OpenAI` providers via raw `fetch`
  (no SDK). Shared vision-prompt builder + defensive JSON parser.
- **Comparison engine** (pure) — `compareFindings(pre, post, {threshold})`
  → `{ newDamage, preExisting, inconclusive }` + `summarizeComparison`.
  Confidence as `confidence_pct` (0-100); threshold a fraction (default
  0.65) converted at one boundary.
- **API** — `DamageAnalysisService` (requestAnalysis, processAnalysis,
  pollStatus/detail, overrideFinding, compareAnalyses, PDF loaders);
  `DamageAnalysisController` (`/damage-analysis`, tenant-scoped `RolesGuard`,
  binary PDF endpoints); `DamageAnalysisWorker` (env-gated `*/2`, max 3
  retries on transient failure). Wired into `app.module.ts`; config +
  accessor added (`DAMAGE_ANALYSIS_PROVIDER`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `*_VISION_MODEL`, `DAMAGE_ANALYSIS_WORKER_ENABLED`).
  Inline data access (no repository).
- **Shared contracts** — `packages/shared/src/damage-analysis/` (enums,
  finding, analysis, comparison) + barrel export.
- **PDF** — `DamageReportPdfService` renders an analysis report and a
  comparison report (cover, findings table, severity-coloured bounding-box
  overlays); bilingual EN/ES; streamed `application/pdf`.
- **Web** — `/jobs/[id]/damage` (server page + client): trigger pre/post
  analysis from evidence photos, operator override/annotate (severity +
  dismiss), pre/post side-by-side with new damage highlighted, PDF download
  (analysis + comparison), EN/ES toggle; BFF route (JSON + binary PDF
  passthrough); `Damage analysis →` link on the job detail.
- **Tests** — compare-logic (16), provider helpers + stub (15), PDF smoke
  (3), web ui-helpers (3); damage RLS spec (8, DB-gated); integration spec
  (8, DB-gated).

## Decision log

See `SESSION_42_DECISIONS.md`. Headlines: pluggable provider w/ raw-fetch
live impls (no new deps); stub never calls a 3rd party; PII never sent;
single confidence boundary; operator annotate-not-delete; inline-first
processing + env-gated retry worker; PDF overlays drawn (not embedded);
consume evidence read-only (no driver-experience edits); migration `0041`.

## Deferred (🟡)

- Embedding real photos behind PDF overlays; auto-trigger on upload;
  customer-facing report; insurance-claim integration; operator
  display-name on the cover; full web i18n. Live provider response shapes
  are best-effort and not CI-exercised (stub is the tested default).

## What was NOT touched

- driver-experience / evidence / storage modules (consumed read-only),
  payments, impound, auth, shared contracts outside `damage-analysis/`,
  `scripts/check-migrations.sh`.

## Test coverage

- `apps/api/src/modules/damage-analysis/compare.logic.spec.ts` — 16
  (new/pre-existing/inconclusive, severity escalation, lost finding,
  threshold filtering, operator override/dismiss).
- `.../provider.spec.ts` — 10 (JSON extraction, enum-injection rejection,
  confidence normalization, prompt). `.../stub.provider.spec.ts` — 5
  (determinism, phase variance, no-bytes).
- `.../damage-report-pdf.service.spec.ts` — 3 (analysis EN, empty,
  comparison ES).
- `apps/api/test/damage-analysis-rls.spec.ts` — 8 cross-tenant isolation +
  FK consistency + triple-unique (DB-gated).
- `apps/api/test/integration/damage-analysis.spec.ts` — 8 full lifecycle:
  request→complete→6 findings, override, compare (5 new / 1 pre-existing /
  2 inconclusive), idempotent re-compare, PDF stream, worker tick (DB-gated).
- `apps/web/.../damage/damage-ui-helpers.spec.ts` — 3 (EN/ES labels,
  effective severity, photo label).

## Known issues

- DB-gated specs (RLS + integration) self-skip locally without Postgres;
  they run in the docker/CI DB path (mirrors every other module).
- `scripts/check-migrations.sh` enforces contiguous numbering and is already
  non-passing on master (pre-existing `0034`/`0036` duplicates); the
  `0038-0040` gap is consistent with that and was a deliberate, documented
  call.
- Live (anthropic/openai) provider code paths are not exercised in CI — the
  stub is the default and the tested path.

## Commands

```bash
pnpm -r run typecheck
pnpm -F @ustowdispatch/api test            # 356 pass (34 damage); DB specs skip
pnpm -F web test                           # damage ui-helper spec passes
pnpm -F @ustowdispatch/shared -F @ustowdispatch/db -F @ustowdispatch/api run build
pnpm -F web run build
# enable a live provider in prod:
#   DAMAGE_ANALYSIS_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-...
#   DAMAGE_ANALYSIS_WORKER_ENABLED=true
```
