# Session 18 — Railway deploy unblocking + end-to-end MFA

Date: 2026-05-12
Branch: `deploy/railway-on-master` (merged to `master`)
Live URLs: `https://api.towdispatch.cloud` · `https://app.towdispatch.cloud`

## What we set out to do

1. Backend was crashing at startup on Railway with
   `ERR_UNKNOWN_FILE_EXTENSION ".ts" for /app/packages/shared/src/index.ts`.
2. Once that was past, every API call was failing with
   `relation "<table>" does not exist` because migrations weren't running on
   deploy.
3. Founder login was getting stuck at `mfa_setup_required` — the front-end had
   no place to land that token.
4. `app.towdispatch.cloud` was returning 502 even though the platform URL served
   200.

Goal: backend + web both healthy on Railway, full MFA enrollment + login flow
working end-to-end on the live environment, no manual SQL.

## What shipped

### 1. Workspace package build pipeline (commit `8f7e4ee`)

Root cause: `packages/shared/package.json` and `packages/db/package.json` had
`main: "./src/index.ts"`. Worked in dev under vite-node / tsx; broke under plain
Node ESM in production.

- Added a `build` script (`tsc -p tsconfig.json && fix-esm-imports.mjs dist`) to
  both packages, switched `main` / `types` / `exports` to point at `dist/`.
- `scripts/fix-esm-imports.mjs` post-processes emitted `.js` to add explicit
  `.js` extensions on relative imports (TypeScript with
  `module=ESNext + moduleResolution=Bundler` doesn't rewrite them, Node ESM
  requires them).
- Kept `@towdispatch/*` path aliases pointing at source in `tsconfig.base.json`
  (and added equivalents to `apps/web/tsconfig.json`) so dev-mode (Next dev,
  vite-node, tsc typecheck) still resolves workspace deps from source without a
  pre-build. Bundler chain honors the aliases; runtime Node falls through to
  the package.json `exports` and reads `dist/`.

### 2. Per-service start dispatcher (commit `326a3a6`)

Railway's railpack auto-build does not honor the `apps/api/railway.toml`
`startCommand`, so the root `pnpm start` was running in both services — which
booted both apps in parallel from the same container, and crashed the web
service because the api couldn't find `DATABASE_URL` there.

- New `scripts/railway-start.mjs` switches on `RAILWAY_SERVICE_NAME` and only
  starts the app that service owns. Root `start` script now points at it.

### 3. /health duplicate route (commit `26c03a9`)

Two Nest controllers were registering `GET /health`, which Fastify rejects at
bootstrap (`Method 'GET' already declared for route '/health'`). Dropped the
duplicate in `modules/health/health.controller.ts` — `/healthz` and `/readyz`
aliases stay; observability owns `/health` along with `/ready` and `/metrics`.

### 4. Migrations on every deploy (commits `3e6206e`, `477477e`, `0d963c6`,
   `1ed0b07`)

The migration runner now runs in the start dispatcher (`migrate: true` branch),
not in `preDeployCommand` (which Railway wasn't honoring under railpack).

Fixed three migration drift bugs surfaced by running migrations against a
blank DB:
- `0001_extensions.sql` wrapped `CREATE EXTENSION "postgis"` in a `DO`/
  `EXCEPTION` block — Railway's stock Postgres image doesn't ship PostGIS, and
  nothing in the schema actually uses it yet. The comment marks it as a
  drop-in for the day we add geometry columns; until then it's a `NOTICE`,
  not an abort.
- `0018_perf_indexes.sql` for `driver_truck_assignments` referenced
  `started_at`; the table only has `created_at`. Swapped the column.
- `0018_perf_indexes.sql` for `stripe_events` referenced `created_at`; that
  table only has `received_at`. Swapped the column.

Failed migrations fail-fast (the runner exits non-zero, Railway marks the
deploy failed, the previous container keeps serving).

### 5. End-to-end MFA flow (commits `91bdc12`, `e3d54aa`)

Schema (`packages/db/sql/0020_mfa.sql` + drizzle mirror):
- `mfa_enrolled_at`, `mfa_recovery_codes text[]`, `mfa_failed_attempts`,
  `mfa_locked_until` on `users`.
- Resets partial MFA state for `chrispeer69@yahoo.com` so the founder account
  can enroll cleanly without manual SQL.

Shared contracts (`packages/shared/src/schemas/auth.ts`):
- `mfaToken` → `challengeToken` on the `mfa_required` response.
- `MfaSetupResponse` now carries `qrCodeDataUrl` and 10 `recoveryCodes`.
- New `mfaSetupRequestSchema`, `mfaVerifyEnrollmentSchema`, `mfaChallengeSchema`.
- `mfaCodeSchema` strips whitespace and dashes and lowercases, so recovery
  codes work whether the user types `abcde-12345`, `abcde12345`, or copies
  with spaces.

Backend (`apps/api/src/modules/auth`):
- `POST /auth/mfa/setup` (Public, takes setupToken): provisions a fresh TOTP
  secret + 10 recovery codes. Secrets are AES-256-GCM at rest; recovery codes
  stored as `sha256(plain)` hex.
- `POST /auth/mfa/verify` (Public, takes setupToken + 6-digit TOTP): completes
  enrollment, marks `mfa_enrolled_at`, returns a full session.
- `POST /auth/mfa/challenge` (Public, takes challengeToken + TOTP or recovery
  code): exchanges for a full session. Replaces the old `/auth/mfa/login`.
- MFA failure tracking: 5 failed attempts in 15 min locks MFA verification for
  15 min via a separate `mfa_failed_attempts` counter, so a bad TOTP does not
  burn a password attempt and vice versa.
- Recovery codes: 10 chars from a Crockford base32 alphabet
  (`abcdefghijkmnpqrstuvwxyz23456789`), displayed as `xxxxx-xxxxx`, consumed
  on use.

Web (`apps/web`):
- `/api/auth/login` proxy stashes `setupToken` / `challengeToken` in
  short-lived `tc_mfa_setup` / `tc_mfa_challenge` httpOnly bridge cookies —
  the JWT never reaches client JavaScript.
- New proxies under `/api/auth/mfa/{setup,verify,challenge}` read the bridge
  cookie, forward to the backend, and on success swap in real session cookies.
- New pages: `/auth/mfa/enroll` (QR + recovery code panel + "I've saved these"
  gate + TOTP verify; copy and download buttons for the recovery codes) and
  `/auth/mfa/challenge` (TOTP entry with a one-click "use a recovery code"
  toggle).
- `login-form` routes `mfa_setup_required` → `/auth/mfa/enroll` and
  `mfa_required` → `/auth/mfa/challenge`. Deprecated `/api/auth/mfa-login`
  proxy removed.

### 6. Live end-to-end test (`apps/api/scripts/mfa-e2e.mjs`)

A reusable script that talks to the deployed Next BFF (cookies + proxies +
api). Generates TOTP via `otplib` so it can run unattended.

```
▶ web https://web-production-7e5b.up.railway.app
signup → 200 authenticated
login (1) → 200 mfa_setup_required
mfa/setup → 200 secret? true codes 10
mfa/verify → 200 authenticated
logout → 200
login (2) → 200 mfa_required
mfa/challenge (TOTP) → 200 authenticated
login (3) → 200 mfa_required
mfa/challenge (recovery) → 200 authenticated
✅ end-to-end MFA flow passed
```

### 7. Custom domain (dashboard)

`app.towdispatch.cloud` was returning 502 with `X-Railway-Fallback: true`
because its target port in the Railway dashboard pointed at port `3000` from
the previous `next start -p 3000` setup — our new `start:prod` honors
Railway's `PORT` env, which is `8080`. Setting the domain's target port to
`8080` in Railway → web → Settings → Networking fixed it. Live verification:

```
$ curl -sI https://app.towdispatch.cloud/
HTTP/1.1 200 OK
Server: railway-edge
```

## Decisions made under the no-questions guardrail

| Decision | Why |
| --- | --- |
| `tsup` was not added; chose a 30-line `fix-esm-imports.mjs` post-pass. | Avoid adding a new build dependency for one transform that only matters because of TS 5.6 + Bundler resolution. |
| Recovery code alphabet `abcdefghijkmnpqrstuvwxyz23456789`. | Crockford-style without `0/1/o/l` — readable when handwritten under stress, and 10 chars × 32 alphabet gives ~50 bits of entropy. Plenty for a single-use code. |
| Recovery codes stored as `sha256` hex, not argon2id. | They are single-use, time-bounded by a verified password challenge, and we want O(1) lookup. Argon2 buys nothing here and slows down a deliberate user. |
| Bridge cookies instead of URL fragments / sessionStorage for MFA tokens. | Keeps the short-lived JWTs entirely server-side. No tokens in browser history, console logs, or DOM. |
| QR rendered server-side as a data URL, plain `<img>` on the client. | No client-side QR library in the bundle. The data URL is the same source of truth the user can scan. |
| Renamed `/auth/mfa/login` → `/auth/mfa/challenge` rather than aliasing both. | The product just launched. Backwards-compat for a one-month-old endpoint is dead weight. |
| MFA lock counter is per-user, separate from password failed-login counter. | A bad TOTP shouldn't lock you out of the password screen, and vice versa. Two counters, two clocks. |
| Postgres image left as Railway's stock (no PostGIS). | Nothing in current schema requires it; swapping the image is a one-line dashboard change when we add geometry. |

## Files touched

```
apps/api/scripts/mfa-e2e.mjs                              new
apps/api/src/modules/auth/auth.controller.ts
apps/api/src/modules/auth/auth.service.ts
apps/api/src/modules/health/health.controller.ts
apps/web/src/app/api/auth/login/route.ts
apps/web/src/app/api/auth/mfa-login/route.ts              deleted
apps/web/src/app/api/auth/mfa/challenge/route.ts          new
apps/web/src/app/api/auth/mfa/setup/route.ts              new
apps/web/src/app/api/auth/mfa/verify/route.ts             new
apps/web/src/app/auth/mfa/challenge/challenge-client.tsx  new
apps/web/src/app/auth/mfa/challenge/page.tsx              new
apps/web/src/app/auth/mfa/enroll/enroll-client.tsx        new
apps/web/src/app/auth/mfa/enroll/page.tsx                 new
apps/web/src/app/login/login-form.tsx
apps/web/src/lib/auth/cookies.ts
apps/web/tsconfig.json
package.json                                              # scripts.start dispatcher
packages/db/package.json
packages/db/sql/0001_extensions.sql                       # postgis optional
packages/db/sql/0018_perf_indexes.sql                     # column drift fixes
packages/db/sql/0020_mfa.sql                              new
packages/db/src/schema/users.ts
packages/shared/package.json
packages/shared/src/schemas/auth.ts
scripts/fix-esm-imports.mjs                               new
scripts/railway-start.mjs                                 new
```

## Open follow-ups (not blocking, surfaced this session)

- The `apps/api/railway.toml` `preDeployCommand` and `startCommand` aren't
  being honored by Railway because the service is built with railpack rather
  than from the Dockerfile. The dispatcher works around this, but if the
  service is ever switched to use the toml properly, we'd want to drop the
  migration step from the dispatcher (it's idempotent — duplicate runs are a
  no-op — but it's still wasted work).
- `experimental.typedRoutes` has been moved to `typedRoutes` in Next 15.5 —
  warning surfaced in the deploy logs. One-line fix in `apps/web/next.config.mjs`
  next time someone is in there.
- The driver Android app's `AuthDtos.kt` still references the old `mfaToken`
  field name (was untouched here since driver clients don't enroll). Will
  need to be updated when the mobile MFA path lands.

## Acceptance criteria — final state

- [x] Backend live at `https://api.towdispatch.cloud/health` → 200
- [x] Web live at `https://app.towdispatch.cloud/login` → 200
- [x] Migrations run on every deploy (verified in deploy logs:
      `0001` through `0020` plus all drizzle migrations applied; final
      `[migrate] done`)
- [x] `signup` → `login (mfa_setup_required)` → `mfa/setup` → `mfa/verify`
      → authenticated session (verified end-to-end against live)
- [x] `login (mfa_required)` → `mfa/challenge` with TOTP → authenticated
- [x] `login (mfa_required)` → `mfa/challenge` with recovery code →
      authenticated
- [x] Founder test account state cleared by 0020 migration; ready for
      manual enrollment
