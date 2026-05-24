# Web Hardening — Decision Log + Session Report

Branch: `chore/web-hardening-r06-r12-r13-r14`
Scope: close 4 Phase 0 audit items in `apps/web` in one PR. No `apps/api` changes.

## TL;DR

- **R-06 Sentry on web** ✅ — `@sentry/nextjs` v10, client/server/edge init, `instrumentation.ts` register hook, `global-error.tsx` wired to `captureException`, `tunnelRoute` to dodge ad-blockers, PII off, source-map upload gated on an auth token so CI builds stay offline-safe.
- **R-12 CSP header** ✅ — full Content-Security-Policy in `next.config.mjs headers()`, mirrors the API Helmet rules, served in prod/`next start` (not `next dev`). Verified in a real Chromium browser: zero violations on `/login`.
- **R-13 Vitest in apps/web** ✅ — jsdom + Testing Library, tests for `client.ts`, `cookies.ts`, the two most-touched forms (`login-form`, `signup-form`), the env guard, and the CSP builder. Pre-existing red suite fixed and wired into a new CI workflow.
- **R-14 fail-fast env** ✅ — build-time guard throws on missing `NEXT_PUBLIC_API_URL` outside dev; browser-bound localhost fallbacks removed. Verified: a prod build with the var unset fails fast.

## Decision log

1. **Package name is `@ustowdispatch/web`, not `@towcommand/web`.** The repo was rebranded (Session 20). All `pnpm --filter` commands and the CI workflow use the real name. The PR title keeps the `towcommand` wording from the task brief.

2. **Client Sentry init lives in `src/instrumentation-client.ts`, not `sentry.client.config.ts`.** `@sentry/nextjs` v10 deprecates `sentry.client.config.ts` (it prints a deprecation warning and *does not work under Turbopack*). `instrumentation-client.ts` is the supported, future-proof location and Sentry auto-detects it in `src/`. Server/edge configs stay as `sentry.server.config.ts` / `sentry.edge.config.ts` (imported by the instrumentation `register()` hook).

3. **Instrumentation file is `src/instrumentation.ts`, not `apps/web/instrumentation.ts`.** With a `src/` directory Next loads instrumentation from `src/`. Placing it at the project root would silently never run.

4. **One canonical Sentry DSN var: `SENTRY_DSN_WEB`.** The browser SDK can only read `NEXT_PUBLIC_*`, so `next.config.mjs` mirrors `SENTRY_DSN_WEB` → `NEXT_PUBLIC_SENTRY_DSN_WEB` (`env` block). Operators set one var. It is a different project from the API's `SENTRY_DSN`. Empty DSN ⇒ the SDK is disabled — no events, no throws — so dev/CI/local builds are no-ops.

5. **`withSentryConfig` is the outermost export wrapper.** Required for `tunnelRoute`. Source-map upload is gated: `sourcemaps.disable = !SENTRY_AUTH_TOKEN`, and `org`/`project`/`authToken` are only passed when present, so PR + e2e + local builds never attempt an upload or hit the network. `silent: true`. `tunnelRoute: '/monitoring'`.

6. **CSP is emitted only when `NODE_ENV !== 'development'`.** `next dev`'s HMR websocket + eval + `upgrade-insecure-requests` would fight an unforgiving policy. `next start` (prod, e2e, Railway) gets the full policy. The base hardening headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy) are emitted in every environment.

7. **`script-src` keeps `'unsafe-inline'` + `'unsafe-eval'`.** Justified, not lazy: `app/layout.tsx` ships an inline anti-flash theme `<script>` and Next injects its own inline bootstrap, with no nonce hook exposed for the static `<head>` script; Mapbox GL needs `eval`. Documented inline in `csp.mjs`. Hydration verified in a real browser — zero violations.

8. **`connect-src` derives the API origin (+ ws/wss) from `NEXT_PUBLIC_API_URL`.** Keeps the policy correct in every environment (local dev `http://localhost:3001` + `ws://`, prod `https://api.towcommand.cloud` + `wss://`) without hardcoding a per-env list. Static entries (Stripe, Mapbox, Sentry ingest, the live API origin) are Set-deduped.

9. **CSP + env-guard live in `.mjs` modules (`csp.mjs`, `env-guard.mjs`), imported by `next.config.mjs`.** `next.config.mjs` is ESM and Node-executed, so a `.ts` helper wouldn't import at runtime. As pure functions they are unit-tested directly (`src/config/*.spec.ts`).

10. **Pre-existing web unit suite was red on master; fixed so it can go into CI.** `offline-queue.spec` stubbed `window` with no `location` (crashed `driverApiBase`) — added `location.hostname`. `reporting.spec` crashed because React 18.3.1's client build omits `cache` (Next supplies it via the `react-server` condition); shimmed `cache` as identity in `vitest.setup.ts` (memoization is meaningless in tests) without switching React builds. Switched the runner to `jsdom`.

11. **New `web-ci.yml` workflow instead of bolting onto `e2e.yml`.** Typecheck + Vitest resolve workspace packages from TypeScript source (tsconfig paths / Vitest aliases), so the job needs no Postgres/Redis and no package builds — fast feedback on every PR, decoupled from the heavy e2e job.

12. **R-14 keeps a dev-only localhost fallback.** The guard throws only outside `development`; server-side page/route handlers keep their localhost dev fallback (they are not browser-bound and the guard + `publicApiBase()` cover prod). All three browser-bound clients route through `publicApiBase()` (localhost in dev, throws in a prod bundle): `offer-client`, `track-client`, and `lib/driver/api-client.ts`. The driver client keeps its `NEXT_PUBLIC_API_URL`-first preference and the protective `app.*→api.*` hostname fallback (Railway's `NEXT_PUBLIC_*` bake quirk), but its *final* fallback is now `publicApiBase()` instead of a hardcoded `http://localhost:3001` — so a misconfigured prod build on a non-`towcommand.cloud` host fails fast instead of silently pointing at localhost.

## Shipped ✅

| File | What |
|---|---|
| `next.config.mjs` | env guard call, `env` DSN mirror, CSP header (non-dev), `withSentryConfig` wrapper |
| `csp.mjs` | pure CSP builder (R-12) |
| `env-guard.mjs` | pure `assertPublicApiUrl` (R-14) |
| `src/lib/api/public-base.ts` | browser API base, throws in prod when unset (R-14) |
| `src/instrumentation.ts` | server/edge Sentry register + `onRequestError` |
| `src/instrumentation-client.ts` | browser Sentry init + `onRouterTransitionStart` |
| `sentry.server.config.ts`, `sentry.edge.config.ts` | runtime Sentry init |
| `src/app/global-error.tsx` | `Sentry.captureException` wired |
| `vitest.config.ts`, `vitest.setup.ts` | jsdom, aliases, jsx, jest-dom, `cache` shim |
| `src/config/{env-guard,csp}.spec.ts` | guard + CSP unit tests |
| `src/lib/api/client.spec.ts` | request building + 401→refresh→retry |
| `src/lib/auth/cookies.spec.ts` | set/clear/parse |
| `src/app/{login/login-form,signup/signup-form}.spec.tsx` | most-touched forms |
| `apps/e2e/tests/e2e-012-csp-headers.spec.ts` | real-browser CSP-violation check |
| `.github/workflows/web-ci.yml` | typecheck + vitest CI |
| `.env.example` | Sentry vars |
| `offer-client.tsx`, `track-client.tsx` | route through `publicApiBase()` |
| `src/lib/driver/__tests__/offline-queue.spec.ts` | fix pre-existing red test |

## Deferred 🟡

- **Sentry Session Replay** — not enabled (privacy + bundle size). Wire `replayIntegration` per-env later if desired.
- **CSP nonce for inline scripts** — would let us drop `'unsafe-inline'` from `script-src`, but Next does not expose a nonce hook for the static `<head>` theme script. Revisit if Next adds first-class nonce support.
- **Full e2e CSP sweep of authenticated pages** — `e2e-012` covers the representative public page (`/login`); the authenticated Mapbox/Stripe/Socket.IO pages are exercised by the existing e2e suite under the new policy in CI (it runs the full stack). The policy already allows every origin those pages use.

## Not touched

- `apps/api` (no Sentry change — already instrumented there).
- `lib/api/client.ts` server resolver and its `[diag-list-empty]` logging (pre-existing).
- `report-only` mode — not used; the policy is enforced in prod as required.

## Test coverage

- `pnpm --filter @ustowdispatch/web test` — **17 files, 89 tests, green** (was red on master: 2 files failing).
- `pnpm --filter @ustowdispatch/web typecheck` — clean (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- `pnpm --filter @ustowdispatch/web build` — green with Sentry wrapper + CSP + guard.
- Real-browser (Chromium) CSP check — **0 violations on `/login`**, header present and locked down.
- R-14 negative: prod build with `NEXT_PUBLIC_API_URL` unset **fails fast** with the guard message.

## Known issues

- `@sentry/nextjs` v10 pulls a large OpenTelemetry server dependency tree (expected for the Node SDK).
- The `/monitoring` tunnel route returns 404 to a bare `GET` — expected; it only accepts the SDK's POST envelopes.

## Commands

```bash
pnpm --filter @ustowdispatch/web typecheck
pnpm --filter @ustowdispatch/web test
NEXT_PUBLIC_API_URL=https://api.towcommand.cloud pnpm --filter @ustowdispatch/web build

# Real-browser CSP check (start the prod server first on :3600)
E2E_RUN_REQUIRES_STACK=1 WEB_E2E_BASE_URL=http://localhost:3600 \
  pnpm --filter @ustowdispatch/e2e exec playwright test tests/e2e-012-csp-headers.spec.ts --project=chromium

# R-14 negative check (must fail)
( cd apps/web && unset NEXT_PUBLIC_API_URL && NODE_ENV=production pnpm build )
```
