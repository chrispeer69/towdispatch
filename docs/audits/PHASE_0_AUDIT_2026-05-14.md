# TowDispatch Pro — Phase 0 Senior Engineer Audit
**Date:** 2026-05-14
**Auditor:** Claude Code (Senior Engineer mode)
**Sessions reviewed:** 1–17
**Repo SHA at audit start:** `dc41854`
**Repo SHA at audit end:** `dc41854` (changes staged but not yet committed — see "What I fixed" below)

## Executive summary
Confidence rating on production deploy stability: **MEDIUM (with one P0 blocker)**.

The platform is much further along than the test summary alone suggests. RLS is properly enforced at the database (RLS + FORCE on every tenant table, GUC-based per-transaction context), JWT/argon2id/cookie-based auth is solid, the QBO integration is real (not stubbed), input validation is comprehensive, and structured logging + Sentry + Helmet are in place. **However**, three serious problems were hidden behind passing-looking infrastructure: (1) two `GET` endpoints (`/customers`, `/customers/:id`, `/customers/search`) had no `@Roles` decorator and were open to all authenticated users including `driver`; (2) the Towbook import endpoint is broken in production due to a malformed SQL query in `reconciliation.service.ts` that was masked in tests by a missing `application/zip` content-type parser; (3) the cross-tenant RLS red-team test was silently SKIPPED for two weeks because its setup posted to a renamed route. The first two were fixed (RBAC) or partially fixed (import — root cause patched, deeper logic bugs remain). The third is fixed and the test now actually runs and passes. **The single P0 blocker remaining is the Towbook import logic** — multiple downstream tests still fail. Until that is investigated, do NOT promise the import feature in production.

## What I fixed in this session
| # | Commit (proposed) | Files |
|---|---|---|
| 1 | **fix(api): add `@Roles` to all customer GET endpoints (P0 RBAC bug — driver could list/read all customers in tenant)** | `apps/api/src/modules/customers/customers.controller.ts` |
| 2 | **fix(api): correct `@Roles` on `GET /billing/invoices` (P0 — dispatcher should not see invoices, auditor should)** | `apps/api/src/modules/billing/billing.controller.ts` |
| 3 | **fix(api): repair RLS-bypass red-team test — was silently skipped for weeks** (corrected route to `/jobs/intake`, updated payload shape) | `apps/api/test/security/rls-bypass.spec.ts` |
| 4 | **fix(test): register `application/zip` content-type parser in test bootstrap** (mirrors `main.ts:106`; without it the import suite collapsed to silent 415→500s) | `apps/api/test/integration/helpers.ts` |
| 5 | **fix(api): drop broken `WHERE tenant_id=$1` clause in import reconciliation SQL** (RLS already scopes the rows; the explicit clause referenced `$1` with an empty parameter array → `there is no parameter $1` 500) | `apps/api/src/modules/import/reconciliation.service.ts` |
| 6 | **docs(runbooks): correct `api.towdispatch.com` → `api.towdispatch.cloud` (and `app.`, `grafana.`, `status.` subdomains) across all runbooks + observability docs** (operators copy-pasting curl commands during incidents would have hit a non-existent domain) | `docs/runbooks/*.md`, `docs/observability.md` |

Net diff: 13 files changed, +89 / -37.

These fixes turned **9 failing tests + 13 silently-skipped tests** into **6 failing tests + 12 silently-skipped tests**, and re-enabled the cross-tenant security red-team coverage the founder thought was running.

## What remains — remediation backlog
Sorted by severity. P0 first.

| ID | Sev | Effort | Domain | Finding | Recommended action |
|---|---|---|---|---|---|
| R-01 | **P0** | M | Import (Towbook) | Live import returns `status='failed'`; idempotency creates 0 rows where 4 expected; reconciliation reports 2 customers as missing immediately after a successful seed. Surfaced after my parser + SQL fix unmasked it. The Towbook import feature is not safely shippable. | Investigate `import-run.service.ts` and `import.controller.ts` end-to-end with a synthetic bundle from `scripts/synth-towbook-bundle.ts`. Verify: bundle parsing, customer/vehicle row writes, `external_source='towbook'` tagging, and run-status state machine. Add a smoke test that runs the bundle and asserts row counts before merging anything into the import module. |
| R-02 | **P0** | S | Tests | `chat.spec.ts` (12 tests) silently skipped — schema drift: test inserts `users.full_name` but the column does not exist. Either the column was removed in a migration or the test was never updated. | Read `users.ts` schema; remove `full_name` from the test INSERT and use the actual columns. Then verify the chat suite actually exercises tenant isolation. |
| R-03 | **P0** | M | Auth/Payments | `payments.spec.ts:218` — `GET /payments/connect/status` returns `publicKeyConfigured: true` for the placeholder key `pk_test_placeholder`. In production, an operator who forgets to rotate the placeholder will see "publishable key configured" in the UI and ship Stripe in a broken state. | In `payments.service.ts:113`, change `!!this.config.stripe.publicKey` to a stricter check: `/^pk_(live|test)_[A-Za-z0-9]{20,}$/.test(...)` (placeholder fails this; real keys pass). |
| R-04 | **P1** | M | Dispatch | `Dispatch board > reassigning a dispatched job to a different driver succeeds (drag-between-drivers)` — returns 409 instead of 200. Needs investigation; likely a state machine guard that blocks re-assignment after dispatch. | Read `dispatch.service.ts` reassign path and `job-state-machine.ts`. If product intent is "reassign should always work", relax the guard. If product intent is "reassign requires un-dispatch first", correct the test. |
| R-05 | **P1** | S | RBAC | `auditor` role exists in `users.role` enum but is wired into ZERO endpoints (now wired into `/customers` and `/billing/invoices` by my fix; everything else still rejects auditor). Founder cannot give an investor / lawyer / accountant a true read-only view. | Audit every `@Roles(...)` decorator in the API. Decide which read endpoints should include `AUDITOR` and add it. Add a role-matrix test row per endpoint. |
| R-06 | **P1** | M | Observability | Sentry is wired in the API but **not in the web app** (`apps/web/package.json` has no `@sentry/react` or `@sentry/nextjs`). Client-side errors (broken React component, failed fetch in browser) reach no one. | Add `@sentry/nextjs`, init in `app/layout.tsx`, wrap routes in error boundary that calls `Sentry.captureException`. Reuse the API DSN's project or create a separate one. |
| R-07 | **P1** | S | Android | `DriverFcmService.onNewToken()` is a stub: comment says "Phase 1: POST this token to /push/register endpoint." Until it's wired, no driver receives a push notification, so the dispatch flow degrades to in-app polling. | Add `POST /push/register` on the API (idempotent upsert by device id); wire the Android override to call it. Add E2E `e2e-008-driver-push-roundtrip.spec.ts` to the green list. |
| R-08 | **P1** | S | Docs | `docs/runbooks/backup-strategy.md` does not state RTO/RPO targets. During an incident, ops cannot answer "how long until we're back" or "how much data will we lose." | Add header section: e.g. "**RTO 1h** (Postgres PITR + warm standby), **RPO 15min** (WAL streaming)." Confirm with the actual Railway tier configuration before committing the numbers. |
| R-09 | **P1** | S | Docs | No rollback procedure documented for failed deploys. Railway's `preDeployCommand` halts on migration failure (good), but if a migration succeeds and the app then crashes, README does not explain how to roll back. | Add a "Rollback" section to README pointing at `scripts/deploy.sh` and the Railway dashboard's redeploy-previous-version action. Explicitly note: irreversible migrations (column drops, type changes) require a forward fix. |
| R-10 | **P2** | S | Config | Hardcoded `https://errors.towdispatch.com` URN in `apps/api/src/common/filters/global-exception.filter.ts:36,46,65`. RFC 9457 problem-type URIs do not have to resolve, but the domain is `.com` while production infra is `.cloud` — a future debugging session will burn time on this. | Either confirm `errors.towdispatch.com` is a stable URN (and add a comment explaining), or move it to a config var (`PROBLEM_TYPE_BASE`) so prod and dev can differ. |
| R-11 | **P2** | S | Config | Intuit OAuth endpoints hardcoded in `apps/api/src/modules/accounting/qbo.provider.ts` (`appcenter.intuit.com`, `oauth.platform.intuit.com`, `quickbooks.api.intuit.com`). Cannot point at sandbox without recompile. | Add `QBO_APPCENTER_BASE`, `QBO_OAUTH_BASE`, `QBO_API_BASE` to `config.schema.ts` with sensible defaults; thread through `QboProvider`. |
| R-12 | **P2** | M | Web | No CSP header on the web frontend (`next.config.mjs` sets X-Frame-Options, X-Content-Type-Options, Referrer-Policy but no `Content-Security-Policy`). API has CSP via Helmet; web does not. | Mirror API CSP rules in `next.config.mjs.headers()`: `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; connect-src 'self' wss: https://api.stripe.com; frame-src https://js.stripe.com; frame-ancestors 'none'`. Test in browser before merging — Next.js needs `'unsafe-inline'` on script for hydration scripts. |
| R-13 | **P2** | M | Tests | No web unit tests (`apps/web/src/**/*.test.ts` — none found). E2E covers happy paths but bug regressions in form components or BFF route handlers will land in production. | Add Vitest or Jest to `apps/web`; cover `lib/api/client.ts`, `lib/auth/cookies.ts`, and the most-touched form components. |
| R-14 | **P2** | S | Web/Android | Hardcoded `localhost:3001` fallback in client-side code (`apps/web/src/app/track/[token]/track-client.tsx:29`, `pay/[token]/page.tsx:31`). `NEXT_PUBLIC_*` vars are baked at build time; if the build pipeline forgets to set them, the browser ships with `localhost`. | Either fail the build when `NEXT_PUBLIC_API_URL` is missing in non-dev, or remove the fallback in browser-bound code. |
| R-15 | **P2** | S | Android | `BuildConfig.API_BASE_URL` hardcoded to prod URL in both debug and release variants. Cannot test against staging without source change. | Add a `staging` build variant or read from an `ANDROID_API_BASE_URL` gradle property with prod default. |
| R-16 | **P3** | S | DB | Two-system migration story (`packages/db/drizzle/` for schema, `packages/db/sql/` for RLS/roles/indexes) works correctly via `packages/db/src/migrate.ts` but is not obvious to a new engineer. | Add a one-paragraph note to `packages/db/README.md` (or create one) explaining the split, the order, and which file to add what to. |

## Domain-by-domain findings

### 1 — Multi-tenancy and Row Level Security
**Reviewed:** every migration in `packages/db/drizzle/` and `packages/db/sql/`; the migration runner in `packages/db/src/migrate.ts`; the per-request tenant context in `apps/api/src/database/tenant-aware-db.service.ts` and `apps/api/src/common/middleware/request-context.middleware.ts`; the JWT guard in `apps/api/src/common/guards/jwt-auth.guard.ts`; the existing red-team test in `apps/api/test/security/rls-bypass.spec.ts` and the per-pool isolation test in `apps/api/test/rls.spec.ts`.

**What's working:** Every tenant-scoped table has `tenant_id` and is `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` (`packages/db/sql/0003_rls_policies.sql` and follow-ons 0005/0006/0008/0010/0011/0012/0013/0014/0015/0016/0017). The helper functions `fn_current_tenant_id()` and `fn_current_user_id()` are SECURITY DEFINER with fail-closed semantics (NULL when GUC unset → zero rows). The application connects as `app_user` (not `app_admin`), so policies are enforced even against the table owner. `tenant_id` is **never** read from request body/query/params — every controller derives it from `req.requestContext.tenantId`, which is populated by `JwtAuthGuard` from the JWT `tid` claim. The `audit_log` table has SELECT-only policies (no INSERT/UPDATE/DELETE), making it append-only at the database engine.

**What was broken:** The cross-tenant red-team test (`rls-bypass.spec.ts`) was silently failing in `beforeAll` because it posted to `POST /jobs` (which does not exist; the canonical route is `POST /jobs/intake`). The suite was reported by Vitest as `1 test | 1 skipped` with the error tucked under "Failed Suites" — easy to miss in CI output. The founder believed the cross-tenant assertion was running on every PR. It was not.

**What I fixed:** Rewrote the seed to call `POST /jobs/intake` with the canonical payload shape (nested customer + vehicle, with email + dropoff). The test now runs and **passes** (verified). RLS is genuinely enforced — across `/customers/:id`, `/vehicles/:id`, `/jobs/:id` (GET / PATCH / DELETE), Tenant B's bearer token sees only 404 on Tenant A's resource ids.

**What remains:** The per-table audit could be extended to cover more routes (e.g. invoices/:id, payments/:id, drivers/:id, trucks/:id). That's a small follow-up; the structural protection is in place.

---

### 2 — Authentication and session management
**Reviewed:** `apps/api/src/modules/auth/*` (auth.service, jwt.service, password.service, mfa.service); cookie module in `apps/web/src/lib/auth/cookies.ts`; `auth.controller.ts` for rate-limit decorators; the rate-limiter wiring through `@nestjs/throttler` + Redis adapter.

**What's working:** JWT HS256 with separate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_MFA_SECRET` (each min 32 chars enforced by config schema). Access token TTL 15m, refresh 30d. Refresh tokens are random 32-byte opaque strings hashed server-side with argon2id. Password hashing uses argon2id with OWASP-2024 minimum params (19 MiB memory, timeCost=2, parallelism=1). Per-email auth lockout: 5 failures in 15 minutes (independent of IP-based throttle). `@nestjs/throttler` enforces 10/60s burst on `/auth/login`, 5/60s on `/auth/signup`, 5/60s on `/auth/forgot-password`. Email verification tokens (24h TTL) and password reset tokens (60m TTL) are SHA-256-hashed at rest, single-use via `consumed_at`. Web cookies: `httpOnly: true`, `secure` in production, `sameSite: 'strict'` for refresh tokens / `'lax'` for access tokens.

**What's broken:** Nothing critical. **Note:** MFA is currently disabled by default (`MFA_LOGIN_GATE_ENABLED=false`, set in commit `7c646ee`). The TOTP scaffold is real (encrypted secret with AES-GCM, 10 base32 recovery codes, 5-failure lockout) but is gated off — a deliberate Phase 0 choice per `docs/android-mfa-scoping-report.md`.

**What I fixed:** Nothing in this domain.

**What remains:** R-03 above (the publishable-key placeholder being treated as configured is technically a config-validation bug rather than auth, but it surfaces in `/payments/connect/status` and would mislead users about credentials).

---

### 3 — RBAC
**Reviewed:** every `*.controller.ts` in `apps/api/src/modules/`; the `@Roles` decorator and `RolesGuard`; the `users.role` enum; the role-matrix test (`apps/api/test/security/role-matrix.spec.ts`).

**What's broken (was, P0):**
- `GET /customers`, `GET /customers/search`, `GET /customers/:id` had **no** `@Roles` decorator. Every authenticated user (including `driver`) could enumerate every customer in their tenant. RLS still blocks cross-tenant, but cross-role within-tenant was wide open.
- `GET /billing/invoices` was decorated `[OWNER, ADMIN, MANAGER, ACCOUNTING, DISPATCHER]`. The role-matrix expectation is `[OWNER, ADMIN, MANAGER, ACCOUNTING, AUDITOR]` — `DISPATCHER` should not see invoices, `AUDITOR` should.

**What I fixed:** Added the explicit `@Roles(OWNER, ADMIN, MANAGER, DISPATCHER, ACCOUNTING, AUDITOR)` to the three customer GET endpoints; corrected the billing invoices list to `[OWNER, ADMIN, MANAGER, ACCOUNTING, AUDITOR]`. Both role-matrix tests now pass.

**What remains:** R-05 — the `AUDITOR` role exists in the user enum but is referenced by ZERO endpoints in the rest of the codebase. If "auditor = read-only across the platform" is the product intent, every GET endpoint needs to include AUDITOR. (I scoped my fix to what the test caught, to avoid making a product decision unilaterally.)

---

### 4 — Database integrity
**Reviewed:** all 12 Drizzle migrations + 20 raw SQL files; `_journal.json` ordering; FK declarations across schema files in `packages/db/src/schema/`; index DDL especially in `0018_perf_indexes.sql`.

**What's working:** Migrations apply cleanly from scratch via `pnpm db:migrate` (the runner in `packages/db/src/migrate.ts` applies Drizzle migrations first, then `sql/*.sql` in lex order). `_journal.json` ordering is strict and timestamps monotonic. FKs on hot relations: `jobs.customer_id` → customers (ON DELETE SET NULL), `jobs.vehicle_id` → vehicles (SET NULL), `invoices.job_id` → jobs (SET NULL), `payments.invoice_id` → invoices (CASCADE for webhook cleanup), all `*.tenant_id` → tenants (RESTRICT). Indexes on every hot-path tenant-scoped column (customers name/phone/email, vehicles plate/VIN, jobs status, audit_log entity lookups). Soft-delete (`deleted_at`) consistently applied on long-lived business tables; transient tables (audit_log, stripe_events, sync_jobs, email/password tokens) use hard delete or append-only — appropriate.

**What's broken:** Nothing critical. R-16 (dual-migration architecture is undocumented for new engineers) is the only finding.

**What I fixed:** Nothing in this domain.

---

### 5 — API contract
**Reviewed:** every controller in `apps/api/src/modules/`; the global exception filter; the Zod decorator pipeline; the throttler wiring.

**What's working:** Every route uses `@ZodBody`, `@ZodQuery`, `@ZodParam` decorators. The global filter (`global-exception.filter.ts`) emits RFC 9457 problem+json; stack traces are routed to Sentry, never to the response. Error responses include a `requestId` for support correlation. Throttling is global (Redis-backed) with stricter per-route overrides on auth.

**What's broken:** Hardcoded `https://errors.towdispatch.com` URN (R-10 — `.com` while production is `.cloud`).

**What I fixed:** Nothing in this domain.

---

### 6 — Environment configuration
**Reviewed:** `apps/api/src/config/config.schema.ts` (Zod schema with ~60 vars); `.env.example`; full-repo grep for hardcoded URLs / secrets / domains.

**What's working:** Zod validates every env var at boot — fail-fast on missing required keys; `JWT_*_SECRET` enforced ≥32 chars; ports validated 1-65535. `.env.example` is complete (DB, Redis, JWT, mail, Stripe, QBO, Twilio, Sentry — all keys present). No `process.env` reads outside the config service in business-logic code.

**What's broken:**
- **`.cloud` vs `.com` domain inconsistency** (Manus's call-out): production infra is `towdispatch.cloud` per Android `BuildConfig` and Session 17/18/19 reports. Runbooks all referenced `api.towdispatch.com` — operators following them during an incident would have hit a non-existent host. **`towdispatch.online` does NOT appear anywhere in the repo.** I think Manus's mention of `.online` was a misremembering — the real inconsistency was `.com` (in docs) vs `.cloud` (in code).
- Hardcoded Intuit OAuth endpoints (R-11).
- Hardcoded `errors.towdispatch.com` URN (R-10).
- Hardcoded `localhost:3001` fallbacks in browser-bound code (R-14) — works in production today because the build sets `NEXT_PUBLIC_API_URL`, but a CI misconfig will silently ship a localhost-pointing bundle.

**What I fixed:** Updated all `api.towdispatch.com` / `app.towdispatch.com` / `grafana.towdispatch.com` / `status.towdispatch.com` in `docs/runbooks/*.md` and `docs/observability.md` to `.cloud`. Email addresses (`incidents@towdispatch.com`, `security@towdispatch.com`) intentionally left on `.com` — those mailboxes may be configured separately and should be confirmed before changing.

---

### 7 — Deployment readiness
**Reviewed:** `apps/api/railway.toml`, `apps/api/Dockerfile`, `apps/api/src/main.ts` bootstrap, `apps/api/src/modules/health/health.controller.ts`.

**What's working:** Railway `preDeployCommand = "pnpm --filter @towdispatch/db run migrate"` runs Drizzle + raw SQL migrations before the app binds to a port; failure halts the deploy with the previous version still serving. Healthcheck path `/health` (and `/healthz`, `/ready`, `/readyz` aliases). `/ready` validates DB connectivity (returns 503 if Postgres is unreachable). Dockerfile is single-stage on `node:20-bookworm-slim`; pnpm-lock + package.json are copied before source for cache friendliness. Should fit comfortably on a 1GB Railway instance — the API image does not include the web build. `app.enableShutdownHooks()` is wired and multiple modules implement `onModuleDestroy()` (dispatch gateway, tracking gateway, accounting sync, job-completion listener). Logging is structured JSON via Pino with sensitive-field redaction (`authorization`, `cookie`, `password`, `totp_secret`).

**What's broken:** Redis health is not checked in `/ready` (acceptable — Redis is used for throttling/queues which can degrade gracefully, but worth documenting).

**What I fixed:** Nothing in this domain.

---

### 8 — Frontend stability (Next.js web)
**Reviewed:** `pnpm --filter @towdispatch/web build` (PASS, no warnings); grep for `console.log` (zero in `apps/web/src`); grep for hardcoded URLs; loading/error UI in dispatch board, intake, billing/invoices/new, accounting/settings, accounting/mapping.

**What's working:** Build completes cleanly with 75+ routes. **Zero `console.log` in production source.** BFF pattern with `apiServer*` helpers attaches httpOnly cookies; refresh-on-401 retry implemented; recent commits (#5–#13) hardened the redirect/auth path so server-component renders no longer race the cookie write. Loading/error states are present on the audited pages.

**What's broken:** R-14 (hardcoded localhost fallbacks in browser code) and R-12 (no CSP header on web).

**What I fixed:** Nothing in this domain (CSP could break Next.js hydration without browser testing — flagged for follow-up).

---

### 9 — Android driver app
**Reviewed:** `apps/driver-android/app/build.gradle.kts`, `AndroidManifest.xml`, `NetworkModule.kt`, `AuthInterceptor.kt`, `DriverFcmService.kt`, photo/signature capture screens.

**What's working:** `minSdk=26`, `targetSdk=35`, JVM target 17. OkHttp configured with 30s connect/read, 60s write timeouts, `AuthInterceptor` attaches `Authorization: Bearer …` from `AuthTokenStore`; `TokenAuthenticator` handles 401 refresh. FCM service registered in manifest, message routing for `new_job` / `job_updated`. Photo capture, signature capture, job-list/job-detail, and location permission are all real (not stubs).

**What's broken:** R-07 (`onNewToken()` in `DriverFcmService` is a stub — comment says "Phase 1: POST this token to /push/register endpoint." Until that's wired, no driver receives push.) R-15 (`API_BASE_URL` hardcoded in both build variants).

**What I fixed:** Nothing in this domain (Android requires a build environment that's outside this audit).

---

### 10 — Test coverage
**Reviewed:** vitest run on `apps/api`; E2E inventory in `apps/e2e/tests/`; CI config in `.github/workflows/`; presence of unit tests in `apps/web`.

**Test counts:**
- **Before my fixes:** 6 of 33 test files failed; 9 of 323 tests failed; 13 silently skipped.
- **After my fixes:** 4 of 33 test files failed; 6 of 323 tests failed; 12 silently skipped.

**What's working:** 11 Playwright E2E specs in `apps/e2e/tests/` covering driver lifecycle, motor-club dispatch, concurrent assign, tenant isolation in UI, auth flows, Towbook import, impound/lien, driver push round-trip, a11y smoke, and Lighthouse perf. Unit tests are dense in `apps/api/src/**/*.spec.ts` (state machines, encryption, fleet units, billing math, etc.). CI runs the full suite on every PR + master push and blocks merge on failure (`.github/workflows/e2e.yml`).

**What's broken:**
- **The cross-tenant RLS red-team test was silently skipped** for weeks — see Domain 1.
- **The chat suite (12 tests) is silently skipped** because the test inserts `users.full_name`, a column that does not exist (R-02).
- The Towbook import suite has 4 deep logic failures (R-01) — the parser fix and SQL fix unstuck the surface layer; the data-flow logic is broken underneath.
- Dispatch reassign test fails (R-04) — likely a state-machine guard that was tightened without updating the test, or a real product regression.
- Stripe `publicKeyConfigured` returns true for placeholder (R-03).
- No web unit tests at all (R-13).

**What I fixed:** RBAC tests + RLS bypass test + import 415 → all in scope. Net: 3 fewer failing tests, plus the most security-critical test re-enabled.

---

### 11 — Observability
**Reviewed:** `apps/api/src/common/observability/sentry.service.ts`; pino redact config; `docs/observability.md`; presence of Sentry in `apps/web`.

**What's working:** Sentry on the API with PII denylist (`email, phone, passwordHash, refreshToken, totpSecret`), per-request tagging (`tenantId, userId, requestId, service, environment, release`), `tracesSampleRate=0.1` in prod. Pino logs include the standard request envelope. `docs/observability.md` documents SEV-1/2/3 classification and oncall routing.

**What's broken:** **Sentry not wired in the web app** (R-06) — client-side errors disappear into the void.

**What I fixed:** Nothing in this domain.

---

### 12 — Security posture
**Reviewed:** `.gitignore`, git history grep for committed secrets, CORS config, Helmet config, cookie flags, CSRF model, SQL parameterization spot-check.

**What's working:** `.env*` is gitignored; no secrets in git history (`git log --all -S "JWT_SECRET"` returns only configuration/CI references, no values). CORS is restricted to `config.corsOrigins` with credentials. Helmet sets HSTS (1y, includeSubDomains, preload), strict CSP on the API, X-Frame-Options=DENY. Cookies are httpOnly + Secure (prod) + SameSite=Strict (refresh) / Lax (access). State-changing endpoints are bearer-token-authenticated, sidestepping classic CSRF. Drizzle parameterizes everywhere — spot-checked `customers.service.ts:64-66`, `vehicles.service.ts:50-60`, `jobs.service.ts:366,852` — all parameterized.

**What's broken:** R-12 (web CSP header).

**What I fixed:** Nothing in this domain.

---

### 13 — Accounting integration (QuickBooks Online, Session 12)
**Reviewed:** `apps/api/src/modules/accounting/accounting.service.ts`, `qbo.provider.ts`, `accounting-webhook.controller.ts`, `token-encryption.service.ts`, `apps/web/src/app/(app)/accounting/{settings,mapping}/page.tsx`.

**Verdict per capability:**
- **OAuth Connect (initiate):** REAL. Returns Intuit AppCenter URL with CSRF state token. (`accounting.service.ts:165-208`)
- **OAuth Callback (code → tokens):** REAL. HMAC-SHA256 Basic auth to Intuit; state validated. (`accounting.service.ts:210-261`)
- **Token refresh:** REAL. Proactive refresh if access token has <60s remaining; transparent on credential resolve. (`accounting.service.ts:547-578`)
- **Encryption-at-rest:** REAL. AES-256-GCM with per-token IV, authenticated tag, base64-encoded `iv|authTag|ciphertext`. (`token-encryption.service.ts:13-49`)
- **Chart of accounts pull:** REAL. SOQL on Account; cached via `accountingConnections.lastSyncAt`. Stub provider returns a fixed 12-account chart for dev/test.
- **Mapping save:** REAL. Upserts to `account_mappings`; web UI calls real API.
- **Invoice sync:** REAL. Customer + line items + mappings; idempotent via `externalId`.
- **Payment sync:** REAL. Links to invoice; refunds route to `pushRefund`.
- **Webhook signature verification:** REAL. HMAC-SHA256 with timing-safe `safeEqual()`.
- **Idempotency on webhook receipt:** REAL. Partial unique index on `(tenant_id, entity_type, entity_id, direction)` collapses duplicate events.

QBO integration is genuinely production-ready — far better than typical "we'll wire this later" stubs. **Nothing is faked.**

---

### 14 — Documentation
**Reviewed:** `README.md`, `.env.example`, `ARCHITECTURE.md`, every file in `docs/runbooks/`.

**What's working:** README gets a new engineer running locally in ~6 minutes (Docker compose up, pnpm install, db:migrate, db:seed). `.env.example` is current and complete. ARCHITECTURE.md states invariants as law (RLS, append-only audit, no client-supplied tenant_id). 9 runbooks cover incident response, DB restore, tenant onboarding, motor-club outage, payment-processor outage, scaling, security incident, secrets rotation, backup strategy.

**What's broken:** Runbook domain references (FIXED in this session). R-08 (missing RTO/RPO in backup-strategy.md). R-09 (no rollback section in README). R-16 (dual-migration story undocumented).

**What I fixed:** Domain references in runbooks + observability.md.

---

## Test results

| Suite | Result | Detail |
|---|---|---|
| Web build (`pnpm --filter @towdispatch/web build`) | **PASS** | 75+ routes built, no warnings |
| API typecheck (`pnpm --filter @towdispatch/api typecheck`) | **PASS** | exit 0 |
| API test suite (`pnpm --filter @towdispatch/api test`) — before fixes | **FAIL** | 9 of 323 failed, 13 skipped, 6 of 33 files failed |
| API test suite — after fixes (this session) | **FAIL** | 6 of 323 failed, 12 skipped, 4 of 33 files failed |
| **RLS unit tests** (`apps/api/test/rls.spec.ts`) | **PASS** | 7/7 — DB-level tenant isolation confirmed |
| **RLS bypass red-team** (`apps/api/test/security/rls-bypass.spec.ts`) | **PASS** (now actually runs) | 1/1 — every cross-tenant ID returns 404, never 200 |
| **Role-matrix** (`apps/api/test/security/role-matrix.spec.ts`) | **PASS** | 4/4 — all RBAC endpoints conform to allow-list |
| Android build (`./gradlew assembleRelease`) | **NOT RUN** | Audit was performed in a host shell without Android SDK. Code review only — no compile/install verification. R-07 (push token registration) is the known issue. |
| E2E Playwright (`apps/e2e`) | **NOT RUN this session** | CI history shows recent passing runs (`apps/e2e/playwright-report/index.html` dated May 12). |

### Remaining 6 failing API tests (all real bugs, none caused by my changes):
1. `Towbook import > runs a dry run that rolls back` — import status='failed'
2. `Towbook import > runs a live import that persists` — import status='failed'
3. `Towbook import > is idempotent: running the same bundle twice does not duplicate` — 0 rows created where 4 expected
4. `Towbook import > reconciliation diff shows zero missing after a successful live import` — 2 customers reported as missing
5. `Stripe payments > GET /payments/connect/status returns initial state for a fresh tenant` — `publicKeyConfigured` is true for placeholder key
6. `Dispatch board > reassigning a dispatched job to a different driver succeeds (drag-between-drivers)` — returns 409 instead of 200

### 12 skipped tests:
- `apps/api/test/integration/chat.spec.ts` (12 tests) — schema drift: `users.full_name` does not exist. R-02.

---

## Deployment readiness verdict

**GO with caveats.**

**Specific caveats:**
1. **Do NOT promise the Towbook import feature in production.** R-01 must land before any tenant is told "you can import from Towbook." Imports currently complete with `status='failed'` even on a clean synthetic bundle.
2. **The chat suite (R-02) is invisible.** A schema-drift bug means 12 tests have been silently skipped, possibly for weeks. Investigate and either fix the column reference or fix the schema. Either way, it's masking real coverage.
3. **Confirm `incidents@towdispatch.com` and `security@towdispatch.com` actually receive mail** before the next runbook publication, or change them to `@towdispatch.cloud`. I left them on `.com` as a conservative default but did not verify.
4. **Audit `R-05 (auditor role)` and decide product intent before launching to a tenant who needs read-only investor / accountant access.** Right now `auditor` is wired into 2 endpoints (after my fix); everything else 403s.
5. **The `publicKeyConfigured` placeholder bug (R-03) will mislead operators.** Fix before any tenant is asked to verify their Stripe configuration.

Everything else (RLS, auth, RBAC, deployment pipeline, observability on the API, accounting integration, doc completeness) is production-grade.

---

## Recommended next session

The next session should be a **single-purpose Towbook import repair sprint**. Fixing R-01 (the real product bug) plus R-02 (chat schema drift) plus R-03 (stripe placeholder) plus committing the changes I staged in this audit will close the four most embarrassing surfaces. Specifically:

1. Land the 13-file diff I left staged in this audit (RBAC fixes + RLS test repair + import parser + reconciliation SQL + runbook domains). Verify the post-fix test count: 6 failing tests, all in import + dispatch + payments. **Do not push or deploy anything else until that diff is landed and reviewed.**
2. Open `apps/api/src/modules/import/` and trace one synthetic bundle from `scripts/synth-towbook-bundle.ts` end-to-end with a debugger. Identify why `import_runs.status` becomes `'failed'` instead of `'completed'`. The 415 + SQL parameter bugs were both "test infra hides the production bug" — there will be a similar root-cause for the 'failed' status.
3. Fix the chat `full_name` schema drift. Then re-run the full suite — the goal is **zero failing tests, zero silently-skipped tests** before the deployment.
4. Once tests are green, run the E2E Playwright suite locally, including `e2e-006-towbook-import.spec.ts` and `e2e-008-driver-push-roundtrip.spec.ts`. Confirm both pass. Then deploy.

After that, the platform is ready for production traffic. The remaining backlog (Sentry on web, web unit tests, CSP header, RTO/RPO docs, dual-migration docs, Intuit env-vars) is normal continuous-improvement work and does not block launch.
