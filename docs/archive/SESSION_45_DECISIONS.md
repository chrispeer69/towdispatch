# Session 45 — Decision Log: Voice-Controlled Driver Workflows

Decisions made during the build, with rationale. No questions were raised to
the user (CLAUDE.md Rule 1); each ambiguity was resolved by mirroring an
existing pattern and documented here.

---

## 1. Worktree bootstrap

The launch block named `/tmp/claude-worktrees/voice-driver` /
`feature/session-45-voice-driver`, which didn't exist. Created it off
`origin/master` (latest: PR #108 merge), pushed the branch, `pnpm install`.
Matches the "Session worktree bootstrap" pattern. Pre-flight gate clean — no
prior voice/CarPlay commits on master.

## 2. Intent catalog = 12, parser may also emit `clarify`

Shipped exactly the 12 intents from the spec in the public `IntentEnum`
(`@ustowdispatch/shared`). The parser additionally returns `clarify` below
the confidence threshold; the response type widens to `12 + clarify`.
`confirm_yes` / `confirm_no` are **internal** recognized-intent values
written to the audit log only — they are NOT in the public enum (advisor
guidance: don't conflate confirmation with `accept_job`).

## 3. Keyword/pattern parser over LLM for v1

Pure, deterministic, dependency-free `parseIntent` (keyword + regex tiers:
strong 0.92 / medium 0.78 / weak 0.55). Rationale: latency (a driver needs
an instant response), cost (no per-utterance model call), and portability
(the pure function can later run on-device/offline). The `LlmIntentProvider`
interface + `KeywordOnlyIntentProvider` are committed as the seam a future
session plugs a classifier into without changing the service signature.

## 4. Confidence threshold default 0.75

`VOICE_DRIVER_CONFIDENCE_MIN`, env-configurable, default 0.75. Strong and
medium matches clear it; a weak single-keyword guess (e.g. bare "help")
falls below and returns `clarify` with the raw guess preserved in
`rawIntent` for the audit log. Used the safe numeric pattern
(`z.coerce.number().min(0).max(1).default(0.75)`) — not a `.url()`-style
default that re-validates and crashes boot.

## 5. Intents → job state machine mapping

The 12 voice intents are richer than the job state machine
(`new→dispatched→enroute→on_scene→in_progress→completed/cancelled/goa`). The
voice layer **does not duplicate** any transition logic — it calls
`JobsService.transition(...)`, the exact path `driver-offline-sync` uses.

| Intent | Maps to |
|---|---|
| `en_route` | `transition → enroute` |
| `arrive_on_scene` | `transition → on_scene` |
| `vehicle_loaded` | `transition → in_progress` (service underway) |
| `clear_job` | `transition → completed` *(confirm)* |
| `decline_job` | `transition → cancelled` + reason *(confirm)* |
| `accept_job` | acknowledgment only — the job is already dispatched to the driver; no state change |
| `en_route_drop`, `arrive_drop` | **informational, no transition** — the state machine has no distinct drop phase; the drop leg happens inside `in_progress`. Logged + spoken back. |
| `request_help` | informational escalation ("dispatch notified"); no transition |
| `repeat_address` | read-only; speaks pickup (or drop-off once loaded) address |
| `eta_update` | informational; minutes parsed + logged; no job column written this session |
| `mark_breakdown` | informational escalation *(confirm)*; **no transition** — a driver-truck breakdown is not a job cancellation |

Illegal transitions (e.g. "loaded" while still `dispatched`) are caught from
`JobsService.transition`'s `BadRequestException` and returned as a spoken
"I can't do that right now — the job is currently {status}" with
`actionExecuted: false`. No 500.

## 6. Confirmation required for destructive intents — STATELESS

`decline_job`, `clear_job`, `mark_breakdown` are two-turn. There is **no
in-memory session**. A pending confirmation is a `voice_command_log` row
with `confirmation_required = true AND confirmed_at IS NULL AND succeeded =
false`. The next bare "yes"/"no" (an utterance with no other intent) looks up
the most recent such row for the driver within a **90-second TTL** (advisor
suggestion) and executes (yes) or cancels (no) it. The decline reason is
re-extracted from the pending row's stored `command_text`, so no extra column
is needed. Two added columns beyond the spec list — `confirmation_required`,
`confirmed_at` — make the pending lookup a clean indexed predicate.

This survives process restarts and horizontal scaling (the state is in
Postgres, tenant-isolated, audited) — a deliberate improvement over an
in-memory map.

## 7. `VOICE_DRIVER_ENABLED` real-gates the surface (default false)

Unlike `EV_RECOVERY_ENABLED` (a documented unconsumed placeholder), this flag
is enforced: the controller returns **503 `service_unavailable`** when off.
Default false — the feature ships dark and ops flips it on per environment
once the native apps are wired.

## 8. Spanish parity for every spoken response (CLAUDE.md Rule 4)

`response_text` is the most user-visible string in this feature, so every key
ships en + es (`voice-responses.ts`). The request carries a `locale` (en|es).
Best-effort Spanish is marked `// TODO(i18n)` for native review.
**Parser keywords are English-only in v1** (documented here) — recognizing
Spanish utterances is deferred; the spoken responses are not.

## 9. Active-job resolution when `jobId` is omitted

`handleCommand` accepts an optional `jobId`. When omitted it resolves the
driver's active jobs (`assigned_driver_id` + non-terminal status). Exactly
one → use it. Zero → "no active job". More than one → ask the driver to open
the job first ("multiple active"). v1 does not disambiguate by voice ("the
Toyota"). The native apps SHOULD pass `jobId` from the open job when they
have one.

## 10. Native scaffolding scope: stubs + spec, not full UI

Per the task ("document, don't fully build") and advisor guidance. Shipped:
`docs/voice-driver/native-integration.md` (the contract), an iOS
`VoiceCommandController.swift` stub (SFSpeechRecognizer + AVSpeechSynthesizer
loop), an Android `VoiceCommandService.kt` stub (SpeechRecognizer + TTS
loop), and a **fully working** web demo (`/driver/voice`, Web Speech API) so
the flow is testable in a browser today. The native stubs keep the
endpoint/DTOs local and are explicitly **not** wired into
`Endpoints.swift` / `USTowDispatchAPI.swift` / `UsTowDispatchApi.kt` or the
CarPlay/Android-Auto manifests — that integration is a native-team follow-up.
Rationale: Swift/Kotlin can't be type-checked in this monorepo's CI, so
editing the production networking layer risks breaking the iOS/Android builds
unverifiably. The conservative, reversible path is a self-contained stub +
documented follow-up.

## 11. `uuidv7`, not `gen_random_uuid()`

`voice_command_log.id` is `uuid PRIMARY KEY` with **no** DB default; the app
passes `uuidv7()` on every insert. Mirrors `0038_lien_processing.sql` exactly
(the orientation agent's `DEFAULT gen_random_uuid()` template was not what
0038 actually does).

## 12. Migration number 0046

Highest on disk was 0042; 0046 is free (the launch block assigned it).
Gaps (0043–0045) are harmless — the runner re-applies all idempotent
`sql/*.sql` each run. Kept the launch-assigned number per the migration-
numbering convention.

---

## Deferred (🟡)

- **LLM intent provider** — interface committed, no model wired.
- **Spanish (and other-language) command recognition** — responses are
  bilingual; parsing is English-only.
- **Custom wake word** ("Hey DISPATCH").
- **Fully offline on-device parsing** — the parser is portable but v1 calls
  the server so the audit log + transitions stay authoritative.
- **Voice multi-job disambiguation** — v1 asks the driver to open the job.
- **ETA persistence** — `eta_update` is logged but not written to a job
  column (no existing column; out of scope).
- **Native production wiring** — CarPlay/Android Auto scenes, manifest
  entitlements, and shared-networking-layer endpoints (native-team follow-up).
