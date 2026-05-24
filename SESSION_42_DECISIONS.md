# Session 42 — Photo Damage Analysis: Decisions Log

**Scope:** AI-vision damage detection over pre-tow / post-tow evidence
photos to defend against fraudulent damage claims. Pluggable vision
provider (stub | anthropic | openai, default stub), a pure pre/post
comparison engine, NestJS module (service + controller + env-gated retry
worker), shared Zod contracts, a PDF damage report, and a web UI on the job
detail.

---

## Provider abstraction (stub | anthropic | openai) — why pluggable

- Mirrors the payments `PaymentProvider` pattern exactly: a small
  `DamageProvider` contract, a DI token (`DAMAGE_PROVIDER`), and a module
  factory that selects the implementation from `DAMAGE_ANALYSIS_PROVIDER`.
- **Default `stub`**: deterministic findings from an FNV-1a hash of
  `(phase + photoKey)` — same inputs → same findings, different phase →
  different findings (so a pre/post comparison over the same photos is
  non-trivial). The stub **never fetches bytes and never calls a third
  party** (`requiresImageBytes = false`) — the "no photos to a 3rd party in
  stub mode" invariant is structural, not a runtime check.
- **Live providers via raw `fetch`, NOT an SDK.** Rule 4 ("no new external
  deps unless required; document additions") + the fact that CI exercises
  only the stub → adding `@anthropic-ai/sdk` and `openai` would pull in code
  paths CI never runs. Both providers POST to `/v1/messages` and
  `/v1/chat/completions` with inline base64 image blocks and parse a strict
  JSON envelope. **Zero new dependencies.**
- **Boot guard, no silent fallback.** Selecting `anthropic`/`openai` without
  the matching API key **refuses to boot** (mirrors the Stripe cutover
  guard) rather than silently degrading to the stub — a stub that never
  analyzes real photos would be a silent failure.

## PII redaction to the vision API

- Only **make / model / year / color** (`vehicleContext`) are sent to a live
  provider. **VIN, plate, and owner identity are never sent and never
  persisted in `vehicle_context`** (ARCHITECTURE.md — PII redaction). The
  Zod `vehicleContextSchema` structurally excludes them.

## Confidence representation (one representation, one boundary)

- Findings carry **`confidence_pct` (integer 0-100)** everywhere — DB
  column, Zod, API surface, PDF.
- The comparison **threshold is a fraction (0..1, default `0.65`)** — the
  task literal. The ONLY place the two meet is `isConfident()` in
  `compare.logic.ts`: `confidencePct / 100 >= threshold`. Persisted on
  `damage_comparisons.confidence_threshold` (numeric) so a comparison is
  reproducible.

## Comparison classification (fraud defense favours flagging NEW damage)

- **new** — confident post-tow damage in an area with no confident pre-tow
  damage, OR a confident severity escalation vs pre-tow.
- **pre-existing** — confident post-tow damage already present pre-tow at
  equal-or-greater severity (a post-tow severity *decrease* is pre-existing,
  never new).
- **inconclusive** — a damage finding below the confidence threshold, OR a
  pre-tow finding not re-detected post-tow (a "lost finding" — can't be
  confirmed and is definitionally not new).
- Severity `none` means "inspected, clean" and is never itself a finding.
- Only **confident** pre-tow findings establish the baseline, so a
  low-confidence pre-tow finding can't suppress a genuine new-damage flag.

## Operator override model — annotate, never delete

- `damage_findings` carries `operator_severity`, `operator_note`,
  `is_dismissed`, `overridden_by/at`. Operators **annotate** findings; they
  never delete them (evidentiary integrity for a fraud-claim defense).
- Comparison + PDF use the **effective severity** (`operator_severity ??
  severity`) and skip dismissed findings.

## Findings stored separately from the raw response (queryable)

- `damage_analyses.raw_response` keeps the model's full payload for audit;
  the structured `damage_findings` rows are the queryable, override-able
  surface. A hallucinated/hostile response can never inject an out-of-enum
  value — `parseVisionFindings` drops anything that fails the Zod schema.

## Inline-first processing + env-gated retry worker

- `requestAnalysis` inserts a `queued` row (RLS validates the job) then
  **processes inline and awaits** — the stub completes within the request,
  so the API returns a `complete` analysis (and the integration test sees it
  without a worker). The provider call runs through the admin
  `TransactionRunner` as a SYSTEM op so the exact same `processAnalysis`
  path serves both inline and the worker.
- The worker (`DAMAGE_ANALYSIS_WORKER_ENABLED`, default false, `*/2 * * * *`)
  is the **transient-failure backstop**: it drains rows left in
  `queued`/`processing` with `retry_count < 3`. A transient failure
  (`DamageProviderError.transient`: 429/5xx/network) re-queues with a bumped
  count; a permanent failure (4xx/parse) or the 3rd retry → `failed`.

## PDF photo overlays — drawn frames, not embedded S3 bytes

- Each bounding box is drawn as a **labelled rectangle on a normalised photo
  frame**, severity-coloured. Embedding the real S3 image behind the overlay
  would couple PDF rendering to object storage and make output
  non-deterministic / untestable. **Deferred** (🟡). The operator still sees
  *where* on the photo the model flagged damage.
- The report is **bilingual EN/ES** (language query param), mirroring the
  invoice PDF.

## Consuming evidence photos without touching the driver-experience module

- The DO-NOT list includes the evidence/photo-storage module. The web damage
  page **reads** the existing `GET /jobs/:id/evidence` endpoint to let the
  operator pick photos; live providers fetch bytes read-only via the
  existing `StorageProvider.get()`. **No evidence/storage file was
  modified.**

## Migration numbering — `0041`

- The task specified `0041_damage_analysis.sql`. Master tops out at `0037`;
  `0038-0040` are the reserved slots for in-flight parallel sessions
  (Session 23 lien = 0038, etc.). The migrate runner applies SQL files in
  lexicographic order and `0041` depends only on pre-existing tables
  (`jobs`, `tenants`, `users`), so ordering after `0037` is safe.
- `scripts/check-migrations.sh` enforces *contiguous* numbering and is
  **already non-passing on master** (pre-existing duplicate `0034_*` and
  `0036_*` files from parallel sessions). The `0038-0040` gap is consistent
  with that existing parallel-session reality; the script was not touched
  (same stance as Session 23).

## Web Spanish parity

- Enum-driven labels (phase / severity / area / status) ship **EN + ES** in
  `damage-ui-helpers.ts`, with an EN/ES toggle wired through the views and
  the PDF `lang` param. Sentence-level UI copy is EN with `// TODO(i18n)`
  markers — the repo has no web i18n framework yet (same posture as the
  impound/lien views). 🟡 full localization deferred to that framework.

## Deferred (🟡)

- **Embedding real photos** behind PDF bounding-box overlays.
- **Auto-trigger** analysis on evidence upload (manual trigger in v1, per the
  DO-NOT list).
- **Customer-facing** damage report (operator-facing only in v1).
- **Insurance-claim integration** (export to a claims system).
- **Operator display-name** on the PDF cover (currently the generating
  user id; a users lookup is deferred).
- **Full web i18n** for sentence-level copy.
- Live provider response shapes are best-effort against the documented APIs
  and are not exercised in CI (the stub is the default + tested path).
