# Session 45 Report — Voice-Controlled Driver Workflows (CarPlay / Android Auto)

## TL;DR

Hands-free, voice-driven job actions for drivers. Backend voice-command API
+ pure intent parser + tenant-isolated audit log + the JS contract the
native apps consume, plus iOS/Android scaffolding and a working web demo.
Voice maps onto the **existing** job-status transitions — zero duplicated
business logic. Destructive intents (decline / clear / breakdown) are gated
behind a stateless spoken confirmation. Ships dark behind
`VOICE_DRIVER_ENABLED` (default false).

Branch: `feature/session-45-voice-driver`. Verification: typecheck ✅,
biome (new files) ✅, tests ✅ (541 API pass / DB-gated skip), build ✅.

---

## What shipped ✅

- **Migration `0046_voice_commands.sql`** — `voice_command_log` audit table.
  FORCE RLS + tenant-isolation policy, `fn_audit_log()` trigger, updated_at
  trigger, cross-tenant consistency trigger (driver + job), soft delete,
  three partial indexes incl. the pending-confirmation predicate. Mirrors
  `0038_lien_processing.sql`.
- **Drizzle schema** `packages/db/src/schema/voice-command-log.ts` + index
  export.
- **Shared Zod contracts** `packages/shared/src/voice-driver/` — 12-intent
  `IntentEnum`, `VoiceCommandRequest`/`VoiceCommandResponse`, platform +
  locale enums, `isDestructiveIntent`. Wired into the package barrel.
- **Pure intent parser** `voice-intent.parser.ts` — deterministic keyword/
  regex matcher (no LLM), entity extraction (minutes, reason, yes/no
  confirmation), confidence tiers, sub-threshold → `clarify`.
  `LlmIntentProvider` seam committed.
- **Bilingual responses** `voice-responses.ts` — every spoken string en + es.
- **`VoiceDriverService`** — parse → resolve job → gate → delegate to
  `JobsService.transition` → audit-log. Stateless confirmation via the log
  table (90s TTL). Illegal transitions return a spoken explanation, not a 500.
- **`VoiceDriverController`** `/voice-driver/command` — `@Public()` +
  `DriverAuthGuard` (driver JWT, separate from operator JWT), real 503 gate
  on `VOICE_DRIVER_ENABLED`.
- **Config** — `VOICE_DRIVER_ENABLED` (default false) + 
  `VOICE_DRIVER_CONFIDENCE_MIN` (default 0.75) in schema + service getters.
  Module wired into `app.module.ts`.
- **Native scaffolding** — `docs/voice-driver/native-integration.md` spec;
  iOS `VoiceCommandController.swift` (SFSpeechRecognizer + AVSpeech loop);
  Android `VoiceCommandService.kt` (SpeechRecognizer + TTS loop).
- **Web demo** — `apps/web/src/app/driver/voice/page.tsx`, Web Speech API,
  fully working + accessible (keyboard, aria-live, text fallback).
- **Tests** — see coverage below.

## Test coverage

- `voice-intent.parser.spec.ts` (43 tests, **run in CI**): happy path each of
  the 12 intents, drop-vs-scene disambiguation, ambiguous → clarify, threshold
  edge (weak match → clarify; lower threshold lets it through), minutes/reason/
  confirmation extraction, bare-confirmation null-rawIntent.
- `voice-driver.controller.spec.ts` (2 tests, **run in CI**): 503 when flag
  off; delegates when on.
- `test/integration/voice-driver.spec.ts` (DB-gated): full-app over a real
  driver JWT — en_route→on_scene transitions move the real job; illegal
  transition explained not crashed; multiple-active-job prompt; decline →
  confirm → "yes" → cancelled; "no" cancels a queued clear; repeat_address
  reads pickup; gibberish → clarify.
- `test/voice-command-log-rls.spec.ts` (DB-gated): cross-tenant SELECT/UPDATE
  isolation, WITH CHECK on foreign tenant_id, fail-closed without GUC,
  consistency trigger rejects cross-tenant driver_id.

## Decisions (see SESSION_45_DECISIONS.md)

12-intent catalog; keyword parser over LLM for v1; 0.75 default threshold;
confirmation required for destructive intents (stateless, in the log table,
90s TTL); intents mapped onto the existing state machine (no duplicated
logic); informational intents for drop-phase/help/eta/breakdown; bilingual
responses with English-only parsing in v1; native scaffolding = stubs + spec
(not wired into production networking layer).

## Deferred 🟡

LLM intent provider (seam only); Spanish command recognition (responses are
bilingual, parsing is en-only); custom wake word; offline on-device parsing;
voice multi-job disambiguation; ETA persistence to a job column; native
production wiring (CarPlay/Android Auto scenes + manifest + shared endpoints).

## What was NOT touched

Driver authentication flow; operator dispatch surface; the job state machine
and `JobsService` logic (only called, never modified); existing migrations.

## Known issues

- Pre-existing repo-wide `pnpm biome check` errors (10) in unrelated files
  (`import/*`, `scripts/synth-towbook-bundle.ts`, `service-catalog-rls.spec`,
  a few web pages) — `noNonNullAssertion`. Not introduced this session; all
  new files are biome-clean.
- Web unit tests are not in CI; `offline-queue.spec` fails locally (pre-
  existing, unrelated).

## Commands

```
# unit (CI):
pnpm --filter @ustowdispatch/api exec vitest run src/modules/voice-driver/
# everything:
pnpm typecheck && pnpm test && pnpm build
# DB-gated integration + RLS (needs DATABASE_URL/REDIS_URL):
DATABASE_URL=... REDIS_URL=... pnpm --filter @ustowdispatch/api test
# try the flow in a browser:
#   open /driver/voice as a logged-in driver (set VOICE_DRIVER_ENABLED=true)
```
