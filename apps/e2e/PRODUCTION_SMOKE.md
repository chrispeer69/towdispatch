# Production Smoke Harness

A single Playwright spec — `tests/production-smoke.spec.ts` — that exercises the
critical path against a **live** deploy (`api.towcommand.cloud` +
`app.towcommand.cloud`):

```
signup → first invoice → Towbook import → web tier reachable
       → deliberate 500 → Sentry event verification → cleanup
```

It hits real services and creates real (synthetic) data. It is **manual-only**
— it does not run in CI and no CI workflow was modified. It is double-gated so
it cannot fire by accident:

- It skips unless `SMOKE_RUN_AGAINST_PROD=1` (set only by `pnpm smoke:prod`).
- That flag is independent of `E2E_RUN_REQUIRES_STACK`, which the normal suite
  uses for the local docker stack — so a CI change to the stack flag can never
  start hitting production.

## Quick start

```bash
cp apps/e2e/.env.smoke.example apps/e2e/.env.smoke
# edit apps/e2e/.env.smoke — fill in the required vars (see below)

pnpm smoke:prod            # from repo root
# or: pnpm --filter @ustowdispatch/e2e run smoke:prod
```

`pnpm smoke:prod` sets `SMOKE_RUN_AGAINST_PROD=1`, auto-loads
`apps/e2e/.env.smoke` (Node's built-in env-file loader — no extra dependency),
and runs only the smoke spec on Chromium.

## Environment

Copy `apps/e2e/.env.smoke.example` → `apps/e2e/.env.smoke` (gitignored; never
commit the filled-in file).

| Var | Required | Purpose |
| --- | --- | --- |
| `PROD_API_URL` | ✅ | API base, e.g. `https://api.towcommand.cloud` |
| `PROD_WEB_URL` | ✅ | Web base, e.g. `https://app.towcommand.cloud` |
| `SMOKE_TEST_EMAIL` | ✅ | Base inbox; each run plus-addresses a unique tag |
| `SMOKE_TEST_TENANT_NAME` | ⬜ | Synthetic tenant display name (default provided) |
| `SMOKE_TEST_PASSWORD` | ⬜ | Owner password; must meet the server policy |
| `SMOKE_DEBUG_TOKEN` | ⬜ | Enables the deliberate-500 leg (see below) |
| `SENTRY_API_URL` | ⬜ | Sentry base; defaults to `https://sentry.io` |
| `SENTRY_API_TOKEN` | ⬜ | Sentry token with `project:read` |
| `SENTRY_ORG` | ⬜ | Sentry org slug |
| `SENTRY_PROJECT` | ⬜ | Sentry project slug |

### Hard vs soft legs

- **Hard-asserted** (failure fails the run): signup, first invoice, Towbook
  import (+ read-back), web `/login` reachable.
- **Soft-skip** (annotation, no failure) when their prerequisites are absent:
  - Deliberate 500 — skipped if `SMOKE_DEBUG_TOKEN` is unset or
    `/_debug/boom` returns 404 (route not deployed / not enabled).
  - Sentry verification — skipped if no 500 was triggered, or if
    `SENTRY_API_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are absent.

## The deliberate-500 endpoint

The 500 is produced by a guarded API route, `GET /_debug/boom?marker=<id>`
(added in this PR). It is **inert by default**:

1. Returns `404` unless `SMOKE_DEBUG_ERROR_ENABLED=true` on the API env.
2. Requires a bearer token matching `SMOKE_DEBUG_TOKEN` (else `401`).
3. When both pass, it captures a Sentry event tagged `smoke_test=true` and
   `smoke_marker=<id>`, then throws a `500`.

To enable it on the target environment, set on the **API** service:

```
SMOKE_DEBUG_ERROR_ENABLED=true
SMOKE_DEBUG_TOKEN=<a long random secret>
```

and put the same `SMOKE_DEBUG_TOKEN` in `apps/e2e/.env.smoke`.

### ⚠️ Alerting

Every run intentionally crashes one request. The event is tagged
`smoke_test=true` precisely so it can be excluded from paging. **Configure your
Sentry alert rules to exclude `smoke_test:true`** before enabling the endpoint,
or each smoke run will page on-call.

The Sentry verification leg searches issues for `smoke_marker:<id>` (the
per-run marker) and polls up to ~90s for indexing.

## Cleanup

There is no tenant soft-delete HTTP endpoint yet, so cleanup is **best-effort**:
the run renames the synthetic tenant with a `[SMOKE-CLEANUP]` prefix (a stable
selector for a future purge job) and never fails the test on cleanup. Synthetic
tenants therefore accumulate in the target DB — purge them periodically by
name prefix until a platform-admin delete endpoint lands. See
`SMOKE_SPRINT_DECISIONS.md`.
