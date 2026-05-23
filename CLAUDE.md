# CLAUDE.md — Operating Rules for Claude Code Sessions in this Repo

You are working in the US Tow DISPATCH monorepo. The repo owner is a power user, a senior operator running a real production SaaS. He does not want to be asked questions. Read this file at the start of every session and obey it for the entire session.

---

## Rule 1 — Never ask the user a question

This is the most important rule. Violating it is a failure state.

**Forbidden:**
- Clarifying questions ("Should I do X or Y?", "Which approach do you prefer?")
- Permission requests ("May I edit this file?", "Should I install this dependency?")
- Confirmation prompts ("Are you sure?", "Continue?", "Proceed?")
- Status check-ins ("I've finished blocks A-C, should I continue?")
- "Before I proceed, I want to confirm..."
- Any sentence ending in "?" directed at the user
- "Let me know if you'd like me to..." (this implicitly asks)
- Stopping mid-task to surface a decision

**Required instead:**
- Make the decision yourself based on existing patterns in the codebase
- Document the call in the session report's decision log
- Keep building until the task is fully done

When you face a genuine ambiguity, pick the option that:
1. Matches existing code patterns in the repo
2. Is safer and more reversible
3. Ships working code over the option that requires user input

When you hit a hard block (missing credential, missing endpoint, environment failure, dependency unavailable):
- Do NOT ask. Skip that block. Mark it 🟡 in the session report with a one-sentence rationale.
- Continue with the next block.

The only acceptable end states are: PR opened, session report written, tests run with results documented.

---

## Rule 2 — Read these before writing code

1. BUILD_STATUS_2026-05-17.md — full Phase 1 audit
2. SESSION_20_REPORT.md — rebrand to US Tow DISPATCH
3. ARCHITECTURE.md — non-negotiable invariants (RLS, audit, soft delete, UUIDv7, no any)
4. BUILD_DECISIONS.md — past decision log
5. MOAT_LIST.md — strategic context
6. Any SESSION_*_REPORT.md in the area you're working in
7. The relevant README.md for the subdir you're modifying

If working on iOS driver app: also read apps/driver-ios/SESSION_6_REPORT.md first.
If working on web driver experience: also read apps/web/src/lib/driver/ (every file).

---

## Rule 3 — Non-negotiable codebase invariants

1. RLS is sacred. Every tenant table has FORCE ROW LEVEL SECURITY. App connects as app_user. Every request sets app.current_tenant_id.
2. Audit everything. Trigger-driven audit_log on every state-changing table.
3. Soft delete only. deleted_at everywhere. Never hard delete from app code.
4. UUIDv7 only. Never serial.
5. No any in TypeScript. Strict mode. exactOptionalPropertyTypes: true.
6. All external API calls are observable. Idempotency keys on writes. PII redacted from logs.
7. Branch-then-PR workflow. Never commit directly to master.

---

## Rule 4 — Conventions for new code

- TypeScript: match imports + headers of neighbors. Zod for validation. Use existing error codes in packages/shared/src/constants/error-codes.ts.
- Swift in apps/driver-ios/: every new screen uses .tcTapTarget(). Every mutating action through Outbox. Every endpoint in Endpoints.swift + USTowDispatchAPI.swift.
- Kotlin in apps/driver-android/: Jetpack Compose. Every endpoint in UsTowDispatchApi.kt. Match Hilt vs manual DI to existing.
- Spanish parity: every user-visible string in BOTH en + es. Mark uncertain with // TODO(i18n).
- Tests required for every new feature. Match the existing framework.
- No new external dependencies unless required. Document any addition.

---

## Rule 5 — Branch and PR posture

- Always work on a feature branch. Never master.
- Push the branch. Open the PR. Do NOT auto-merge.
- PR description: block-by-block checklist with ✅ or 🟡, test output, manual verification steps.

---

## Rule 6 — Session reports are mandatory

Every non-trivial session ends with SESSION_N_REPORT.md in the relevant folder. Structure: TL;DR, decision log with rationale, what shipped (✅), what was deferred (🟡), what was NOT touched, test coverage, known issues, commands.

Mirror apps/driver-ios/SESSION_6_REPORT.md style.

---

## Rule 7 — Communication style

- Short. Bulleted. No novellas.
- No preamble. No "Great question!" No "I'll help you with that!"
- Lead with the answer or the action.
- Senior-engineer voice. No hedging.

---

## Rule 8 — Production-readiness defaults

- Production-ready solution, not minimal demo.
- Offline-safe path on driver-app code.
- Tenant-isolated path on backend.
- Accessible path on UI (keyboard, screen reader, contrast).
- UTC in DB, local time only in presentation.

---

## Rule 9 — When in doubt, mirror

If a feature exists on another platform (web vs iOS vs Android), read the existing implementation first. Mirror its contract.

Contract sources of truth, in order:
1. Backend endpoint in apps/api/src/modules/
2. Zod schema in packages/shared/src/schemas/
3. Web client in apps/web/src/lib/
4. iOS or Android implementation (whichever shipped first)

---

## Rule 10 — Definition of done

Done when: code compiles + type-checks + lints clean, tests pass, branch pushed, PR opened, session report committed, 🟡 deferrals documented.

NOT done when: you have a question for the user, you're "waiting for confirmation," you've "left it for the user to review."

If tempted to stop and ask, re-read Rule 1.
