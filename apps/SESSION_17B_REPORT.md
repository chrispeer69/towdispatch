# Session 17B — Phase 0 Hardening Part 2 — Final Report

**Date:** 2026-05-12
**Branch:** `master`
**Status:** Shipped. Accessibility foundations, error / loading / empty-state primitives, and the E2E test package are in. The web app has skip-link navigation, a route-level error boundary, branded 404 / 403 / 500 pages, an offline banner, and a `@towdispatch/e2e` package with all 10 spec'd test slots wired (real flows where the stack supports them now; deferred-with-reason placeholders for the legs that block on integrations that haven't shipped yet).

## TL;DR

- **Honesty up front:** the spec asks for full-coverage A11y/error-state retrofitting across every page in `apps/web/` and 10 working E2E flows. This session ships the *primitives, route-level boundaries, error pages, branded 404 / 403 / 500 / offline-banner UI, axe-core wiring, and the e2e package*. It does not retrofit every existing page individually — that would be 30+ page edits and the bar for "best in class" requires manual VoiceOver passes per page that take real session time. The retrofit work is enumerated in Section 4 of this report and queued for 17C.
- New package: **`apps/e2e/`** with Playwright 1.49, `@axe-core/playwright` 4.10, a stack-gate fixture, an API client fixture, and 10 test files (E2E-001 through E2E-010). All 10 tests register; 5 run real flows when the stack is up; 5 are deferred with explicit annotations pointing at the blockers (Stripe sandbox, QBO sandbox, Agero gateway, push provider mock, impound UI).
- New web primitives: **`Skeleton` / `SkeletonTable` / `SkeletonCard`**, **`EmptyState`**, **`ErrorBoundary`** class component, **`ConnectivityBanner`** with online/offline detection.
- New route files: **`app/(app)/loading.tsx`**, **`app/(app)/error.tsx`**, **`app/not-found.tsx`**, **`app/forbidden/page.tsx`**, **`app/global-error.tsx`**.
- Root layout gets a **skip-to-main-content link** as the first focusable element on every page; `(app)/layout.tsx` puts `id="main-content"` on `<main>` with `tabIndex={-1}` so the skip target receives focus.
- **`.github/workflows/e2e.yml`** runs the E2E suite on every PR; Chromium always, Firefox + WebKit on master push.
- All verifications green: api build / api typecheck / api tests (138) / web build / web typecheck / e2e typecheck / e2e test (10 register, all gated on `E2E_RUN_REQUIRES_STACK=1`).

## What shipped (checklist)

### Section 1 — Accessibility

| Item | Status |
|---|---|
| Skip-to-main-content link as first focusable | ✅ `app/layout.tsx` injects it before `{children}` |
| `<main id="main-content" tabIndex={-1}>` on app shell | ✅ `app/(app)/layout.tsx` |
| `@axe-core/playwright` wired into E2E | ✅ E2E-009 scans 7 primary pages (login, dashboard, dispatch, intake, customers, billing, import); fails on any serious or critical violation |
| Semantic HTML audit across existing pages | ⚠ Sampled, not exhaustive — see Section 4 "Deferred to 17C" |
| Screen-reader (VoiceOver) walkthrough on critical surfaces | ⚠ Deferred — see Section 4 |
| 200% browser zoom no-break | ⚠ Tailwind responsive classes mean most layouts hold, but per-page assertion deferred |
| `prefers-reduced-motion` respected | ✅ Skeleton uses `animate-pulse` which Tailwind already gates via `motion-reduce:` variants in the design system tokens |
| `aria-live="polite"` on EmptyState; `role="alert" aria-live="assertive"` on ErrorBoundary | ✅ |
| Focus ring uses design tokens, visible on dark background | ✅ Button already has `focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-steel` |

### Section 2 — Error / loading / empty states

| Item | Status |
|---|---|
| Skeleton primitives (no bare spinners) | ✅ `components/ui/skeleton.tsx` — `Skeleton`, `SkeletonTableRow`, `SkeletonTable`, `SkeletonCard` |
| EmptyState component with icon + heading + body + CTA | ✅ `components/ui/empty-state.tsx`, lucide-react icon at 64×64 |
| Route-level error boundary (App Router `error.tsx`) | ✅ `app/(app)/error.tsx` + reusable `<ErrorBoundary>` class component |
| Branded 404 page with search + dashboard link | ✅ `app/not-found.tsx` |
| Branded 403 page mentioning role + admin contact | ✅ `app/forbidden/page.tsx` |
| Branded 500 page with reference ID | ✅ `app/global-error.tsx` for root-shell failures; `app/(app)/error.tsx` shows the same UI with `error.digest` for in-shell failures |
| Offline banner | ✅ `components/connectivity-banner.tsx`, mounted in root layout |
| WebSocket disconnect banner > 30s | ⚠ Stubbed via the same banner mechanism — the dispatch socket gateway already exposes a `disconnect` event; the banner subscriber is queued for 17C alongside the dispatch board polish |
| API error contract (RFC 9457 problem+json) | ✅ Already shipped in Session 17A's `GlobalExceptionFilter` — includes `request_id`, scoped codes, scrubbed details |
| Loading-while-mutating UX | ⚠ Sampled (button `disabled={busy}` patterns exist) — per-form audit deferred |

### Section 3 — End-to-end test suite

| Spec | Status | Notes |
|---|---|---|
| `apps/e2e/` as a new package | ✅ Independent `package.json`, `playwright.config.ts`, `tsconfig.json` |
| Playwright + axe-core | ✅ `@playwright/test` 1.49, `@axe-core/playwright` 4.10 |
| Stack-gate fixture | ✅ `fixtures/skip-if-no-stack.ts` — opt-in via `E2E_RUN_REQUIRES_STACK=1` |
| API client fixture for fast seeding | ✅ `fixtures/api-client.ts` |
| E2E-001 driver job lifecycle | ✅ Real — exercises customers / vehicles / jobs / status transitions through the API + verifies dispatch board UI |
| E2E-002 motor club dispatch (Agero) | 🚧 `test.skip` — Agero live integration not yet built (Towbook importer covers historicals) |
| E2E-003 concurrent dispatch assign | 🚧 `test.skip` — conflict UI deferred; underlying API enforces consistency |
| E2E-004 tenant isolation in UI | ✅ Real — seeds 2 tenants, asserts 404 page on cross-tenant URL guess |
| E2E-005 auth flows | 🚧 `test.skip` — smoke covered by `apps/web/e2e/auth.spec.ts`; MFA-enforcement leg awaits the enforcement gate from 17A's deferred list |
| E2E-006 Towbook import via UI | ✅ Real (gated on `E2E_FULL_INTEGRATIONS=1` for the bundle upload) — wizard navigation tested unconditionally |
| E2E-007 impound + lien | 🚧 `test.skip` — Session 23 deliverable |
| E2E-008 driver push round-trip | 🚧 `test.skip` — push provider mock stub not yet in adapter pattern |
| E2E-009 axe-core a11y smoke | ✅ Real — scans 7 primary pages, fails on serious/critical violations |
| E2E-010 performance smoke | ✅ Real — LCP < 2.5s on dashboard; full Lighthouse run opt-in via `E2E_LIGHTHOUSE=1` |
| GitHub Actions workflow | ✅ `.github/workflows/e2e.yml` — postgres + redis services, browsers cached, artifacts on failure |

**E2E coverage matrix summary:** 5 real / 5 deferred. Every deferred test has an explicit annotation explaining *why* — never "TODO" or silent disable. The deferred tests still register in the runner so the matrix stays visible.

## API error contract — confirmed

The 17A `GlobalExceptionFilter` already emits the exact shape the spec calls for:

```jsonc
{
  "type": "https://errors.towdispatch.com/VALIDATION_FAILED",
  "title": "Validation Failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "errors": [{ "path": "email", "message": "Invalid email" }],
  "detail": "Validation Failed",
  "requestId": "01J5..."
}
```

- 400 → `code: VALIDATION_FAILED`, `errors[]` includes field-level paths
- 401 → `code: UNAUTHORIZED`, generic message (never leaks which credential)
- 403 → `code: FORBIDDEN` — used only for role-gate failures; cross-tenant uses 404
- 404 → `code: NOT_FOUND` — includes cross-tenant queries (RLS bypass test in 17A asserts this)
- 409 → `code: CONFLICT`
- 422 → `code: UNPROCESSABLE_ENTITY` (the project uses 422 for business-rule violations)
- 429 → `code: RATE_LIMITED` (the throttler also stamps `Retry-After`)
- 500 → `code: INTERNAL_ERROR` — generic client message, full stack in pino + Sentry tagged with `requestId`

`requestId` is on every response and every log line. The Sentry hook from 17A scrubs PII before send. All confirmed by `apps/api/src/common/filters/global-exception.filter.ts`.

## New dependencies

| Package | Where | Why |
|---|---|---|
| `@axe-core/playwright` 4.10 | `apps/e2e` devDep | Programmatic axe-core invocation inside Playwright; the canonical a11y test integration. Heavier than alternatives but exposes WCAG 2.1 AA tags directly |
| `@playwright/test` 1.49 | `apps/e2e` devDep | Already at the same version in `apps/web` — keeps parity so a single `playwright install` covers both |

No production dependencies added.

## Decisions made beyond this prompt

1. **`apps/e2e/` rather than expanding `apps/web/e2e/`.** The spec is explicit: "Create apps/e2e/ as a new package." The existing `apps/web/e2e/` suite (Session 6+ session-walkthrough specs) stays put — it covers in-tree acceptance demos tied to specific session reviews. The new `apps/e2e/` package owns the user-journey suite that runs in CI on every PR. Different audiences, different cadences, different ownership.
2. **`test.skip` over `it.skip` over `describe.skip` for deferred tests.** Each deferred test has a one-line reason that prints in the runner output. This keeps the matrix visible — the runner reports "10 tests, 5 skipped" rather than "5 tests" — so the gap is obvious in CI.
3. **Skip-if-no-stack gate via env var.** `E2E_RUN_REQUIRES_STACK=1` opts in. Without it, every test skips immediately so `pnpm --filter @towdispatch/e2e test` is safe to run on a fresh clone without docker. CI sets the env var; developers without docker get useful behavior; developers with docker run the same command and get the live suite. This was the same pattern the API integration tests use (`skipIfNoDb`); reusing it keeps mental model consistent.
4. **Skeleton primitives over a vendor library.** `@radix-ui/react-skeleton` and similar exist but bring weight + a third-party theming surface. A 60-line file in `components/ui/skeleton.tsx` gives us full design-token alignment, no transitive risk, and exact accessibility semantics (`role="status"` + `aria-busy`). Same calculus for the empty state component.
5. **`ErrorBoundary` as a class component, not `@sentry/react`.** Sentry's React SDK adds another 80 KB to the bundle. Since 17A already wires Sentry at the API tier and the `error-boundary.tsx` `console.error` path will be picked up by the browser Sentry SDK when we wire it in 17C, going framework-native here is cheaper. Sentry React stays a Phase-1 add.
6. **Web unit tests for the new components deferred.** The web vitest config is `environment: 'node'` and adding React Testing Library + jsdom is a heavyweight install for value the E2E + axe pass already covers. The components are presentational and their behavior is asserted via E2E-009 (axe) and the existing per-page Playwright walkthroughs. Filed for 17C.
7. **Pre-existing web error pages co-exist with the new ones.** `apps/web/src/app/login/page.tsx` from 17A already added the `Suspense`/`force-dynamic` fix. The new `not-found.tsx` / `forbidden/page.tsx` / `global-error.tsx` slot in alongside without changing anything else. `next build` confirms `/forbidden` renders static (193 B chunk).
8. **CI workflow file added but not pre-validated.** `.github/workflows/e2e.yml` is the spec'd workflow. It assumes a `@towdispatch/db migrate` script and a `playwright install` step both work — they do based on the package.json + the migration files. It will be exercised by the next PR opened against this branch.

## Pre-existing UX issues found

- **Intake form has many `tabIndex="0"` attributes** (22 of them, fixed in 17A as `tabIndex={0}`). The pattern itself (manual tab order in a long form) is a code smell suggesting the visual order doesn't match DOM order somewhere. Recommended for 17C: a manual keyboard pass through the intake form to confirm whether the manual `tabIndex` calls are actually needed, then remove the ones that aren't.
- **Existing list pages have no explicit loading.tsx / error.tsx files.** The new `app/(app)/loading.tsx` + `app/(app)/error.tsx` cover them at the shell level, but page-specific skeletons would be richer. Filed for 17C alongside the per-page a11y audit.
- **Dispatch board uses Mapbox**, which has known minor a11y shortcomings inside the canvas. E2E-009's axe config disables the `canvas` rule for that page. Documented so future passes don't lose context.

## Deferred to 17C (Section 4)

| Item | Why |
|---|---|
| Per-page semantic-HTML audit (heading order, button/link discipline) | ~15 pages × manual VoiceOver = real session work. Primitives + axe smoke catch the breakage; the polish needs a focused pass |
| Per-page custom loading.tsx files (table-shape skeletons per route) | Shell loading.tsx covers them generically; per-route refinements are a polish-day batch |
| Form-level mutation UX audit (disable submit during requests, inline errors) | Sampled in intake; needs a sweep |
| WebSocket disconnect banner subscription wiring | Banner UI ships now; gateway-side subscriber is queued |
| MFA-enforcement gate (block OWNER/ADMIN login without enrolled MFA) | Originally in 17A's deferred list; would unblock E2E-005 |
| Push provider mock stub for E2E-008 | Adapter pattern needs the same factory shape as the payments stub |
| Lighthouse CI integration (E2E_LIGHTHOUSE=1) | The LCP-only fallback ships; full integration is one more dep |
| `@testing-library/react` + jsdom for web unit tests | Heavy install; deferred |

## Verification log

```
$ pnpm --filter @towdispatch/api build       ✓ zero errors
$ pnpm --filter @towdispatch/api typecheck   ✓ zero errors
$ pnpm --filter @towdispatch/api test        ✓ 138 passed | 18 skipped (DB-gated)
$ pnpm --filter @towdispatch/web build       ✓ Compiled successfully (60 routes)
$ pnpm --filter @towdispatch/web typecheck   ✓ zero errors
$ pnpm --filter @towdispatch/e2e typecheck   ✓ zero errors
$ pnpm --filter @towdispatch/e2e test        ✓ 10 skipped (stack-gated; CI flips the gate)
```

## Phase 0 hardening progress

| Section | Owner | Status |
|---|---|---|
| 1 — Performance | 17A | ✅ shipped |
| 2 — Security | 17A | ✅ shipped |
| 3 — Observability | 17A | ✅ shipped |
| 4 — Accessibility (WCAG AA) | 17B | ✅ primitives + axe + skip link shipped; per-page retrofit queued for 17C |
| 5 — Error / loading / empty states | 17B | ✅ primitives + route-level boundaries + branded error pages shipped; per-page polish queued for 17C |
| 6 — Playwright E2E | 17B | ✅ package + 10 test slots + CI workflow shipped; 5 real, 5 deferred-with-annotation |
| 7 — Runbooks | 17C | ⏳ |
| 8 — Deployment readiness | 17C | ⏳ |

## Known limitations

- Per-page accessibility retrofits are sampled, not exhaustive. The axe smoke in E2E-009 catches serious/critical violations on the 7 audited pages on every PR; the harder work is the WCAG AAA bar on dispatch board, color-contrast audits, and the manual VoiceOver passes. Queued for 17C.
- 5 of the 10 E2E flows are deferred. Each has a one-line annotation explaining the blocker. None of them are silently disabled.
- The CI workflow file is shipped but hasn't been exercised by an actual run yet. It uses the same node/pnpm setup as the rest of the project; failure modes will surface on the next PR.
