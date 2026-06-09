# Smoke Sprint — Decision Log

**Branch:** `feature/production-smoke-harness`
**Date:** 2026-05-23
**Goal:** Production smoke test harness — one Playwright spec exercising
signup → first invoice → Towbook import → deliberate 500 → Sentry verification
against `api.ustowdispatch.cloud` + `app.ustowdispatch.cloud`. Manual-only (`pnpm
smoke:prod`); no CI workflows modified.

## TL;DR

Shipped a single comprehensive spec (`apps/e2e/tests/production-smoke.spec.ts`)
plus a guarded `GET /_debug/boom` API endpoint to make the Sentry leg testable.
Three requested steps had no backend support (deliberate-500, Sentry query,
tenant soft-delete); each was resolved per the decision log below, all calls
made without blocking. Core flow is hard-asserted; the 500 + Sentry legs
soft-skip when their prerequisites are absent. Lint + typecheck + unit test
green.

## Pre-flight

`git log origin/master --oneline -100 | grep -i "smoke|e2e-prod"` → no match.
No existing smoke harness; proceeded.

## Decisions

### D1 — Skip the email-verification round-trip (no Mailosaur/SendGrid inbox)
The brief said "verify email (use Mailosaur or SendGrid sandbox inbox per
existing patterns)." **There is no existing inbox pattern** — `e2e-005-auth-
flows` signs up with plain `@spec.test` addresses and proceeds. And
`auth.service.ts:55-89` issues tokens on signup unconditionally; login is not
gated on `emailVerifiedAt`. **Call:** mirror the existing pattern — signup
returns tokens, use them directly. No inbox dependency added. Each run plus-
addresses `SMOKE_TEST_EMAIL` (`you+smoke-<id>@domain`) for uniqueness.
*Rationale:* Rule 9 (mirror existing contract) + avoids a heavyweight external
dependency for zero verification value.

### D2 — Deliberate 500 via a new guarded endpoint, not abuse of an existing one
No `/debug/error`-style route existed, and existing endpoints return 4xx (not
5xx) for bad input, so there was no reliable way to provoke a real 500.
**Call:** add `GET /_debug/boom?marker=<id>` (NestJS module `apps/api/src/
modules/debug/`). It is inert by default:
1. `404` unless `SMOKE_DEBUG_ERROR_ENABLED=true`.
2. `401` unless a bearer token matches `SMOKE_DEBUG_TOKEN` (constant-time
   compare, mirroring `admin-email.controller.ts`).
3. On pass: captures a Sentry event, then throws `500`.
*Rationale:* This is Sentry's own recommended verification pattern. It ships in
a PR that is **not** auto-merged (Rule 5), so the owner reviews before it can
reach prod. Inert-by-default + token gate keeps blast radius near zero.

### D3 — Capture the Sentry event in the handler, tagged, to avoid paging
The global exception filter only forwards non-HTTP `Error`s to Sentry. **Call:**
the handler captures the event itself via a new `SentryService.captureSmokeError
(marker, err)` that tags `smoke_test=true` + `smoke_marker=<id>`, then throws an
`HttpException` (which the filter does NOT re-capture). Result: exactly one
event, always tagged. *Rationale:* every smoke run crashes a real request; the
`smoke_test=true` tag lets alert rules exclude synthetic crashes so on-call is
never paged. Documented prominently in the README.

### D4 — Sentry verification by REST API, soft-skip without creds
The app is send-only; no Sentry org/project/token is wired. **Call:** the spec
polls the Sentry issues API (`/api/0/projects/{org}/{project}/issues/?query=
smoke_marker:<id>`) using smoke-only env vars (`SENTRY_API_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, optional `SENTRY_API_URL`). If those are absent, the spec
still hard-asserts the 500 occurred and **soft-skips** the Sentry match with an
annotation. *Rationale:* keeps the harness runnable on a deploy without Sentry
query creds while fully verifying when they exist.

### D5 — Best-effort tenant cleanup (no soft-delete endpoint) 🟡
No tenant soft-delete HTTP endpoint exists; `PATCH /tenants/current` only
accepts `name`/`settings`, and the settings partial schema strips unknown keys
then rejects an empty object (so a custom cleanup flag can't be stored).
**Call:** rename the synthetic tenant with a stable `[SMOKE-CLEANUP]` prefix as
the purge selector; cleanup is wrapped in try/catch and never fails the test.
*Rationale:* safest reversible option using an existing endpoint.

### D6 — Double-gate the spec so it can never run in CI
The e2e Playwright config picks up every file in `tests/`. **Call:** the spec
self-skips unless `SMOKE_RUN_AGAINST_PROD=1` (set only by `pnpm smoke:prod`),
which is independent of the suite's `E2E_RUN_REQUIRES_STACK` docker flag.
`playwright.config.ts` loads `apps/e2e/.env.smoke` via Node's built-in
`process.loadEnvFile` (no new dependency) only when that flag is set.
*Rationale:* a future CI change to the stack flag can never accidentally fire
real signups/imports at production. No CI workflow files touched.

## What shipped ✅

- `apps/e2e/tests/production-smoke.spec.ts` — single comprehensive flow.
- `apps/e2e/PRODUCTION_SMOKE.md` — run instructions + env + alerting warning.
- `apps/e2e/.env.smoke.example` — all env vars (`.env.smoke` gitignored).
- `apps/e2e/package.json` + root `package.json` — `smoke:prod` script.
- `apps/e2e/playwright.config.ts` — opt-in env-file load (guarded).
- `apps/api/src/modules/debug/` — guarded `GET /_debug/boom` + unit test.
- `apps/api/src/common/observability/sentry.service.ts` — `captureSmokeError`.
- `apps/api/src/config/{config.schema,config.service}.ts` — `SMOKE_DEBUG_*`.
- `apps/api/src/app.module.ts`, `.env.example` — wiring + documented env.

## Deferred 🟡

- **Tenant accumulation.** Every run leaves a `[SMOKE-CLEANUP]`-prefixed tenant
  in the target DB. Follow-up: add platform-admin `DELETE /platform/tenants/:id`
  (soft-delete via existing `tenants.deletedAt` column) + a purge job that
  selects by name prefix. Tracked here until that PR lands.
- **Enabling the 500 + Sentry legs in prod** requires setting
  `SMOKE_DEBUG_ERROR_ENABLED=true` + `SMOKE_DEBUG_TOKEN` on the API env and
  Sentry query creds in `.env.smoke`, **and** adding a Sentry alert exclusion
  for `smoke_test:true`. Until then those legs soft-skip.

## Not touched

- CI workflows (per constraint).
- The existing e2e suite, `apps/web/e2e`, and the local-stack `skipIfNoStack`
  path.

## Test coverage

- `pnpm --filter @ustowdispatch/api exec vitest run src/modules/debug/...` →
  6/6 pass (inert-without-flag, 404-without-token, 401 missing/wrong token,
  tagged-capture+500, marker default).
- `pnpm --filter @ustowdispatch/api run typecheck` → clean.
- `pnpm --filter @ustowdispatch/e2e run typecheck` → clean.
- `biome check` on all changed files → clean.
- The smoke spec itself was not executed end-to-end: it requires live prod
  targets + secrets that aren't available in this environment (🟡).

## Commands

```bash
cp apps/e2e/.env.smoke.example apps/e2e/.env.smoke   # then fill in
pnpm smoke:prod                                       # run the smoke
```
