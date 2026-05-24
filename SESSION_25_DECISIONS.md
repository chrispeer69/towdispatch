# Session 25 — Self-Serve Onboarding — Decision Log

**Branch:** `feature/session-25-self-serve-onboarding-b`
**Worktree:** `/tmp/claude-worktrees/onboarding-b` (fresh from `origin/master` @ 2b446ff)
**Status:** in progress

---

## TL;DR

Self-serve onboarding composed on top of the **existing** auth signup/verification flow.
New surface = a post-signup wizard (company info → first user → first truck → first driver →
free-tier activation) plus an activation-milestone ledger that culminates in the
"first job dispatched" goal. Signup, tenant provisioning, and email verification already
shipped in the `auth` module (PR history) — this session does **not** re-implement or modify
them; it wraps and observes them.

---

## Decision log

### D1 — Parallel session collision → isolated worktree + competing PR
The assigned worktree `/tmp/claude-worktrees/onboarding` already existed on branch
`feature/session-25-self-serve-onboarding` and was being **actively written by another agent**
during this session: `git status` went from clean to showing freshly-created
`0036_onboarding.sql`, `onboarding-progress.ts`, `tenant-activation-events.ts` (mtimes ~2 min
before this session began writing, created in sequence 12–18s apart). The task's setup command
(`git worktree add onboarding origin/master`) could not succeed against an existing worktree.
**Call:** do not race a live writer in the same directory (guaranteed corruption of both efforts).
Isolated to a brand-new worktree `onboarding-b` with branch suffix `-b`, built independently,
will open a **competing PR**. Nothing was pushed to `origin` by the other session
(`git ls-remote` empty), so the `-b` branch is additive. Maintainer chooses between the two PRs.

### D2 — Compose on top of `auth`; never modify it
`AuthModule` exports `AuthService` (`signup`, `verifyEmail`). The onboarding module imports
`AuthModule` and calls these — no edits to any auth file. Public signup/verify endpoints in
onboarding are thin wrappers that add funnel concerns (captcha gate, stricter per-IP rate limit,
progress-row creation, activation milestones) and return the same `AuthenticatedResponse`.

### D3 — Web keeps using the existing `/api/auth/signup` BFF for cookie-setting
The web BFF route `/api/auth/signup` sets the httpOnly session cookies (`tc_at`/`tc_rt`).
Creating a new BFF route `apps/web/src/app/api/onboarding/*` is **out of the allowed file scope**,
so the web signup form continues to POST to the existing auth BFF (cookies get set), then
redirects into the wizard. The onboarding API's own `POST /onboarding/signup` endpoint still
exists and is fully tested — it is the funnel entry for API/non-web consumers. First authenticated
wizard load (`GET /onboarding/progress`) lazily creates the progress row, so both entry paths
converge.

### D4 — New DB tables defined as **local** drizzle pgTables inside the module
Allowed file scope excludes `packages/db/src/schema/`. Drizzle's query *builder*
(`tx.select/insert/update`) works with any `pgTable` object regardless of the `schema` option
(only the `tx.query.*` relational API needs registration). So the two new tables are declared in
`apps/api/src/modules/onboarding/onboarding.tables.ts` and used via the builder. The DDL lives in
`packages/db/sql/0036_onboarding.sql` (the real migration location; the task's
`packages/db/migrations/` is an empty legacy dir — interpreted as "the DB migration mechanism").
Existing registered tables (`trucks`, `drivers`, `jobs`, `users`) are *imported* from
`@ustowdispatch/db` for activation counting (import ≠ edit).

### D5 — New Zod contracts defined **locally**, existing shared schemas reused by import
`packages/shared/src/schemas/` is out of allowed scope. Onboarding-specific contracts (progress
DTO, step enum, tier-activation payload, public-signup body) live in
`apps/api/src/modules/onboarding/onboarding.contracts.ts` and a small mirror under the web wizard.
Entity-creation steps reuse the already-shared `companyProfilePatchSchema`, `createTruckSchema`,
`createDriverSchema`, `createInviteSchema` (imported, not edited). Trade-off: minor type
duplication for the progress DTO vs. strict scope adherence — chose scope adherence per the
explicit constraint.

### D6 — Activation ledger = idempotent, recomputed from **real** state
`tenant_activation_events` is an append-only ledger with a `UNIQUE (tenant_id, event_type)` index;
emission is `INSERT … ON CONFLICT DO NOTHING` (emit-once). Milestones are recomputed on every
`GET /onboarding/progress` and after each step, observing real table state rather than coupling to
the dispatch/fleet modules (which are out of scope to modify):
- `email_verified` ← owner user `email_verified_at IS NOT NULL`
- `first_truck_added` ← `count(trucks WHERE deleted_at IS NULL) > 0`
- `first_driver_added` ← `count(drivers WHERE deleted_at IS NULL) > 0`
- `first_user_invited` ← `count(users WHERE role <> 'owner' AND deleted_at IS NULL) > 0`
- `first_job_dispatched` ← `count(jobs WHERE status IN ('dispatched','enroute','on_scene','in_progress','completed')) > 0`
- `company_info_completed` ← `'company_info' ∈ steps_completed`
- `account_created` (at progress creation), `free_tier_activated` (at activate),
  `onboarding_completed` (at complete).

### D7 — Wizard composes existing endpoints; onboarding API tracks the funnel only
The onboarding API owns `onboarding_progress` + `tenant_activation_events` only. The web wizard
creates real entities by calling existing endpoints via server actions (no new BFF routes):
`PATCH /tenants/current` (company info), `POST /users/invite` (first user),
`POST /fleet/trucks` (first truck), `POST /fleet/drivers` (first driver). Each step then calls
`PATCH /onboarding/steps/:step` to persist resumable `step_data` and advance `current_step`.

### D8 — Captcha = env-gated stub via `process.env`
`config.service.ts`/`config.schema.ts` are out of scope, so the captcha gate reads
`process.env.ONBOARDING_CAPTCHA_ENABLED` directly. Disabled by default (no-op pass); when enabled,
the stub requires a non-empty `captchaToken` (real hCaptcha/reCAPTCHA verification is a documented
TODO). Signup rate limit: `@Throttle` sustained 5 / 3600s per IP on `POST /onboarding/signup`.

### D9 — Free-tier truck cap
`TIER_TRUCK_LIMITS = { free: 2, starter: 25, pro: null /* unlimited */ }`. `POST /onboarding/activate`
validates current live truck count ≤ the activated tier's cap (free ⇒ ≤ 2 trucks).

---

## What shipped (✅)

**API** (`apps/api/src/modules/onboarding/`)
- `onboarding.tables.ts` — local drizzle pgTables for the two new tables.
- `onboarding.contracts.ts` — local Zod schemas, literal unions, tier-limit table, DTOs.
- `captcha.ts` — env-gated stub verifier.
- `onboarding.service.ts` — get-or-create progress (race-safe), step persistence, tier
  activation with truck-cap enforcement, completion, and idempotent activation recompute
  from real tenant state. Exports `nextStepFrom`.
- `onboarding-public.controller.ts` — `@Public` `POST /onboarding/signup` (captcha gate +
  5/hour-per-IP throttle, composes `AuthService.signup`) and `POST /onboarding/verify-email`.
- `onboarding.controller.ts` — owner/admin: `GET /progress`, `POST /recompute`,
  `PATCH /steps/:step`, `POST /activate`, `POST /complete`.
- `onboarding.module.ts` + wired into `app.module.ts`.

**DB** — `packages/db/sql/0036_onboarding.sql` (RLS FORCE + isolation policy, audit triggers,
set-updated-at trigger, idempotent guards, CHECK constraints, partial unique + idempotency
indexes). No GRANT needed — `0002_roles.sql` `ALTER DEFAULT PRIVILEGES` covers new tables.

**Web** (`apps/web/src/app/signup/`)
- `wizard/page.tsx` — authenticated server-component loader (reads session cookie, bounces to
  /login, lazily seeds progress).
- `wizard/wizard.tsx` — client multi-step UI (company info, invite, truck, driver, activate),
  stepper, live milestone checklist, email-verification banner, a11y labels + live regions.
- `wizard/actions.ts` — server actions composing existing endpoints (tenants/current,
  users/invite, fleet/trucks, fleet/drivers) + onboarding step/activate/complete.
- `wizard/types.ts` — local DTO mirror.
- `signup-form.tsx` — redirect after signup now goes to `/signup/wizard`.

## Test coverage
- `onboarding-logic.spec.ts` — 9 pure unit tests (nextStepFrom paths, captcha gate, tier
  limits). Run everywhere; green locally.
- `test/onboarding-service.spec.ts` — 12 integration tests (`describeIfDb`) exercising the full
  service against a real RLS-enforced Postgres: row creation, idempotency, step persistence, all
  activation milestones (email/invite/truck/driver/dispatched-job), free-tier cap accept+reject,
  completion + guard. Skip locally (no DB); run in CI.

## Deferred / 🟡
- 🟡 **Activation is eventual-consistency, not real-time.** `first_job_dispatched` (and the other
  observed milestones) emit on the next `/onboarding/progress` or `/onboarding/recompute` call,
  not at the instant a job is dispatched. Wiring a real-time hook would require modifying the
  dispatch module (out of scope). A `POST /onboarding/recompute` endpoint is provided so a client
  (e.g. the dashboard) can nudge the ledger. See D6.
- 🟡 **Production web signup hardening lives in auth, not the new endpoint.** The web flow uses the
  existing `/api/auth/signup` BFF (auth's `@Throttle` 5/60s, no captcha). The new
  `POST /onboarding/signup` adds the 5/hour-per-IP throttle + captcha gate but is exercised by
  API/non-web consumers + tests, not the production web path (no new BFF route allowed in scope).
  See D3. To harden the production path, either repoint the web to a BFF that proxies
  `/onboarding/signup`, or add the captcha/limit to auth (out of scope this session).
- 🟡 **Captcha is a stub.** Env-gated (`ONBOARDING_CAPTCHA_ENABLED`), disabled by default; when
  enabled it only checks token non-emptiness. Real hCaptcha/reCAPTCHA siteverify is a TODO at the
  seam in `captcha.ts`. See D8.
- 🟡 **Welcome email not sent on completion.** Auth already sends the verification email; a
  completion welcome email was skipped to avoid extra coupling/external calls. `EmailService` is
  globally available if added later.
- 🟡 **No local DB/Docker** (Docker unavailable; image needs PostGIS) — integration tests and the
  migration were not executed locally; verified by typecheck + CI-targeted specs.

## What was NOT touched
- The `auth` module (composed on top, never edited).
- `packages/db/src/schema/`, `packages/shared/`, `config.*` (kept out per scope; worked around).
- The parallel session's worktree `/tmp/claude-worktrees/onboarding`.
