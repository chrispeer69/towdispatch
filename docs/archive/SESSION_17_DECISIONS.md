# Session 17 — Phase 0 Hardening — Decision Log

## TL;DR

Reliability/observability hardening. Most of the infrastructure the brief
asked for **already existed** (Sentry SDK + PII scrubbing in the API, a
Redis-backed throttler with per-endpoint + per-email auth limits, `/health`
and `/ready` probes that check DB + Redis), so this session **audited and
filled the gaps** rather than rebuilding:

- **Free-text PII scrubber** (`redactPii`) wired into the global exception
  filter's error-log line (the one place PII could leak inline — e.g. a
  Postgres constraint error echoing an email).
- **Admin Sentry-test endpoint** `GET /admin/sentry-test` (OWNER/ADMIN) to
  verify the capture path end-to-end.
- **Web Sentry** — installed `@sentry/nextjs`, DSN-gated instrumentation
  (server/edge/client), source-map upload gated on `SENTRY_AUTH_TOKEN`.
- **Backup-verify** — pure freshness assessment + daily env-gated cron that
  alerts Sentry on failure + a `pnpm tsx` CLI; fails **closed**.
- **Docs** — `apps/api/RATE_LIMITS.md`, `docs/sre/slo.md`,
  `docs/ops/secrets-rotation.md`, `.env.example` additions.
- Removed two stale `[diag-list-empty]` `console.log` leftovers in the web API
  client.

All gates green: `pnpm typecheck`, `pnpm lint` (exit 0), `pnpm test` (324
passed / 410 DB-gated skipped), `pnpm build`.

## Decision log (rationale)

1. **Audit, don't rebuild.** A grep-first pass showed the API already had:
   pino with structured request context (`requestId`/`tenantId`/`userId`/`ip`
   on every line via `LoggingInterceptor`) + `redact.paths` for known PII
   keys; `SentryService` with `beforeSend` PII denylist; a Redis throttler
   with per-route `@Throttle` on all auth endpoints + per-email caps in
   `AuthService`. Per CLAUDE.md Rule 9 (mirror existing), I extended these
   rather than introducing parallel mechanisms.

2. **`/health` + `/ready` already existed — adding them would have COLLIDED.**
   `HealthMetricsController` (common/observability) already serves `GET /health`
   (liveness) and `GET /ready` (DB **and** Redis ping), and these are exactly
   what `scripts/deploy.sh` and `.github/workflows/e2e.yml` probe. The
   `modules/health` `HealthController` serves the older `/healthz` + `/readyz`
   (DB only). I did **not** add `/health`/`/ready` to the latter (two
   controllers on the same route breaks routing); I added the missing **tests**
   for `HealthMetricsController` (incl. the 503-when-DB/Redis-down paths) and a
   clarifying comment on the alias relationship. Net: deliverable #1 was
   already satisfied; I made it verifiable.

3. **PII scrubber scope.** Added a pure `redactPii(s)` (email/phone/SSN, only
   high-confidence shapes — never mangles UUIDs/timestamps/money) and applied
   it to `errMessage` + `errStack` in `GlobalExceptionFilter`. The logger
   itself is **untouched** (Rule: "do not refactor the logger"). Sentry
   receives the **original** exception, so its own scrubbing + stack grouping
   are unaffected — the stack is only scrubbed in the pino log, where the
   header line echoes the message. Unit-tested directly.

4. **`/admin/sentry-test` is new and distinct from `/_debug/boom`.** The brief
   names `/admin/sentry-test` (admin-only). The existing `/_debug/boom` is
   bearer-token-gated and **public** (for the unauthenticated production-smoke
   harness) — different threat model. New `AdminController` (first `admin/*`
   route), `RolesGuard` + `[OWNER, ADMIN]`, throws a plain `Error` so the
   global filter routes it to Sentry.

5. **Web Sentry — installed, not deferred.** Tried the install first
   (`@sentry/nextjs ^10.53.1`); it succeeded and the web build stays green, so
   I wired it: `instrumentation.ts` (server/edge), `instrumentation-client.ts`
   (browser), `sentry.{server,edge}.config.ts`, and `withSentryConfig` in
   `next.config.mjs`. Everything is **DSN-gated** (empty DSN ⇒ no-op). Session
   Replay is off (sample rates 0) to avoid shipping PII-bearing DOM recordings
   without an explicit decision.

6. **Source-map upload is auth-token-gated.** `withSentryConfig`'s
   `sourcemaps.disable` is `!SENTRY_AUTH_TOKEN`, so a local/tokenless build
   skips upload and is otherwise unaffected; CI/deploy sets the token. The
   token wiring **into the CI secret store** is an ops step (🟡).

7. **Backup-verify fails closed and does not guess the Railway API.** The pure
   `assessBackupFreshness(lastBackupAt|null, now, maxAgeHours)` treats `null`
   (unverifiable) as a **failed** check — an unverifiable backup is not a
   passing one. The actual Railway backup-metadata fetch is **not guessed**
   (the GraphQL shape isn't confirmed against the live project); the fetcher
   returns `null` until wired (🟡). The cron alerts via
   `sentry.captureMessage('alert:backup_verify_failed', …)`; the CLI
   (`scripts/ops/verify-db-backup.ts`) exits non-zero. Both share the one pure
   function so they can't disagree.

8. **Decisions-doc naming.** Brief says `SESSION_17_DECISIONS.md`; CLAUDE.md
   Rule 6 says `SESSION_N_REPORT.md`. Honored the brief's filename, written in
   the report structure to satisfy both.

## What shipped ✅

- **PII scrubber:** `apps/api/src/common/observability/redact-pii.ts` (+ spec,
  10 tests). Wired into `common/filters/global-exception.filter.ts`.
- **Health/ready tests:** `common/observability/health-metrics.controller.spec.ts`
  (6 tests incl. db-down + redis-down 503). Clarifying comment on
  `modules/health/health.controller.ts` (alias relationship).
- **Web health/ready:** `apps/web/src/app/health/route.ts` (liveness),
  `apps/web/src/app/ready/route.ts` (non-cascading API reachability).
- **Admin Sentry test:** `apps/api/src/modules/admin/{admin.controller,admin.module}.ts`
  → `GET /admin/sentry-test` (OWNER/ADMIN). Wired into `app.module.ts`.
- **Web Sentry:** `@sentry/nextjs` + `instrumentation.ts`,
  `instrumentation-client.ts`, `sentry.{server,edge}.config.ts`,
  `next.config.mjs` wrap.
- **Backup verify:** `modules/ops/{backup-verify.logic.ts (+spec, 5 tests),
  backup-verify.cron.ts, ops.module.ts}`, `scripts/ops/verify-db-backup.ts`.
  Config: `BACKUP_VERIFY_CRON_ENABLED`, `BACKUP_MAX_AGE_HOURS`,
  `RAILWAY_API_TOKEN` (+ `config.service.backupVerify` getter). Wired into
  `app.module.ts`.
- **Docs:** `apps/api/RATE_LIMITS.md`, `docs/sre/slo.md`,
  `docs/ops/secrets-rotation.md`, `.env.example` (web Sentry DSN/org/project/
  auth-token + backup-verify keys).
- **Logging audit:** removed two stale `[diag-list-empty]` `console.log`
  blocks in `apps/web/src/lib/api/client.ts`. API has zero `console.*`.

## Deferred 🟡

- **Railway backup-metadata fetch.** The freshness logic, cron, CLI, alerting,
  and config all ship; the actual Railway API call is not wired (GraphQL shape
  unconfirmed against the live project) — fails closed until then.
- **`SENTRY_AUTH_TOKEN` in CI.** Source-map upload is coded + gated; setting
  the token in the deploy secret store is an ops action.
- **JWT zero-downtime rotation.** The rotation runbook documents the forced
  global re-login today and a `JWT_SECRET_PREVIOUS` dual-key follow-up; not
  implemented this session.
- **Datadog.** `DD_*` config + the dd-trace stub already exist; left as the
  documented alternate to Sentry.

## What was NOT touched

`compliance/` (S31), the pino logger construction, existing throttle limits
(documented only), the `/healthz` `/readyz` aliases' behavior, and any product
feature surface.

## Test coverage

- New unit tests: `redact-pii` (10), `backup-verify.logic` (5),
  `health-metrics.controller` (6) = **21**, all passing.
- Full API suite: **324 passed | 410 skipped** (DB-gated RLS/integration specs
  self-skip without the docker Postgres/Redis stack — repo norm).

## Known issues / out of scope

- DB-gated specs require `DATABASE_URL`/`DATABASE_ADMIN_URL`/`REDIS_URL`; they
  self-skip otherwise (unchanged behavior).
- `scripts/check-migrations.sh` has a pre-existing 0034 duplicate-prefix issue
  (noted in SESSION_22_DECISIONS.md); unrelated to this session — no migration
  added here.

## Verification

```bash
pnpm typecheck                       # green (all packages)
pnpm lint                            # exit 0 (21 pre-existing warnings, none mine)
pnpm --filter @ustowdispatch/api test# 324 passed | 410 skipped (DB-gated)
pnpm build                           # green (web + api)
pnpm tsx scripts/ops/verify-db-backup.ts   # exits 1 (fails closed when unconfigured)
```
