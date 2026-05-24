# SESSION 25 — Self-Serve Onboarding

## TL;DR

Shipped a self-serve onboarding flow that **composes on top of** the existing
auth signup (never modifying it): public signup → tenant provisioning → email
verification (all already owned by auth) → a multi-step onboarding wizard
(company info, first user, first truck, first driver) → free-tier activation
(2 trucks/2 drivers, configurable) → "first job dispatched" activation-goal
tracking. New API module, two DB tables with RLS + audit + idempotency, shared
Zod contracts, web wizard with resume + verify nudge, and 34 new unit tests
plus a DB-gated RLS spec. `pnpm build` green; full API suite green (259 passed,
0 failed). New code is biome- and type-clean.

## Decision log

See `SESSION_25_DECISIONS.md` (D1–D7 + pre-existing-issue deferrals). Headlines:
compose-don't-duplicate over auth (D1); derive "first job dispatched" by reading
job state, not by hooking dispatch (D2); module-local env-overridable free-tier
config (D3); company-info updates `tenant.name` only to avoid the 17-field
Company-Profile first-save gate (D4); English UI + `// TODO(i18n)`, no
`(public)` group (D5); documented additive-file deviations incl. the onboarding
BFF proxy (D6); idempotent activation ledger (D7).

## What shipped ✅

**DB** (`packages/db`)
- ✅ `sql/0036_onboarding.sql` — `onboarding_progress` (soft-delete, one live
  row/tenant, step CHECK, audit + updated_at triggers, RLS+FORCE, `app_user`
  grants) and `tenant_activation_events` (append-only, `(tenant,event_type)`
  unique, event_type CHECK, audit trigger, RLS+FORCE, grants).
- ✅ Drizzle schemas `onboarding-progress.ts`, `tenant-activation-events.ts`
  (+ `schema/index.ts`).

**Shared** (`packages/shared`)
- ✅ `schemas/onboarding.ts` — start payload, 4 wizard-step payloads, skip,
  progress DTO, checklist, activation-event DTO, start response (+ `index.ts`).

**API** (`apps/api/src/modules/onboarding`)
- ✅ `POST /onboarding/start` (`@Public`, `@Throttle`, 5/hr/IP via Redis,
  env-gated captcha hook) → delegates to `AuthService.signup`, seeds progress
  + `account_created`/`free_tier_activated`.
- ✅ `GET /onboarding/progress` — ensures the row, refreshes derived milestones,
  computes the resume step, returns DTO + checklist + events.
- ✅ `POST /onboarding/steps/{company-info,first-user,first-truck,first-driver}`
  — delegate to `TenantsService` / `UserInvitesService` / `TrucksService` /
  `FleetDriversService`; free-tier caps enforced on truck + driver.
- ✅ `POST /onboarding/skip`, `POST /onboarding/complete`.
- ✅ `ActivationService` (idempotent emit + derived checklist), `CaptchaService`
  (env-gated stub), `onboarding.config.ts` (free tier), wired into
  `app.module.ts`.

**Web** (`apps/web/src/app`)
- ✅ `signup/` multi-step wizard: `account-step` → `company_info` → `first_user`
  → `first_truck` → `first_driver` → `done`, with a stepper, resume-on-reload
  (`GET /api/onboarding/progress`), persistent email-verify banner + resend,
  skip on optional steps, and a final checklist surfacing the
  "first job dispatched" activation goal. `page.tsx` now renders the wizard;
  obsolete single-step `signup-form.tsx` removed.
- ✅ BFF proxies `api/onboarding/start` (sets session cookies) and
  `api/onboarding/[...path]` (authenticated catch-all).

## Tests & coverage

- ✅ 34 new unit tests (5 files): `onboarding.config`(4), `captcha.service`(6),
  `activation.service`(6), `onboarding.controller`(3), `onboarding.service`(15)
  — all pass. Use a hand-rolled `TenantAwareDb` fake (table-reference equality)
  + mocked domain services.
- ✅ `test/onboarding-rls.spec.ts` — 6 RLS/idempotency cases (fail-closed,
  cross-tenant read/update/insert, milestone uniqueness, one-live-row). DB-gated;
  skips without `DATABASE_URL` (matches every existing `*-rls.spec.ts`).
- ✅ Coverage on the onboarding module: **95.66% stmts/lines** (service 95%,
  controller/config/caller-context/activation 100%, captcha 86% — only the
  defensive provider-failure branch uncovered; `onboarding.module.ts` is
  DI-only wiring). Meets the 90%+ bar on new logic.
- ✅ Full API suite: **259 passed, 382 skipped (DB-gated), 0 failed** —
  app bootstrap with `OnboardingModule` healthy.

## Commands

```
pnpm --filter @ustowdispatch/api exec vitest run src/modules/onboarding   # 34 pass
pnpm --filter @ustowdispatch/api run test                                 # 259 pass / 0 fail
pnpm build                                                                # green (web + api)
pnpm --filter @ustowdispatch/api run typecheck                            # clean
pnpm --filter @ustowdispatch/web  run typecheck                           # clean
# RLS integration (needs a DB):
DATABASE_ADMIN_URL=… DATABASE_URL=… pnpm --filter @ustowdispatch/api exec vitest run test/onboarding-rls.spec.ts
```

## What was deferred 🟡

- 🟡 Captcha provider is a **stub** (env-gated). `CaptchaService.verifyWithProvider`
  returns true; swap for a real hCaptcha/reCAPTCHA/Turnstile `siteverify` call
  (single function, no call-site changes) when the secret is provisioned.
- 🟡 **Spanish parity** — web has no i18n framework; strings are English with
  `// TODO(i18n)`. Adding next-intl is a separate effort.
- 🟡 Company-info captured in `step_data` is **not** auto-promoted into the
  structured Company Profile (`tenants.settings`) — see D4. Admin Settings
  remains the source of truth for the 17-field profile.
- 🟡 `pnpm lint` (38 errors) and 1 web test failure are **pre-existing** in
  files this branch never touched — see Decisions doc. Not fixed: out of scope
  + forbidden by the file constraint.

## What was NOT touched

Auth module (composed, not modified), jobs/dispatch (read-only derivation),
fleet/users/tenants services (called via DI, not edited), and every file
outside `modules/onboarding/`, `app/signup/`, `app/api/onboarding/`,
`packages/db` (schema+sql), `packages/shared/src/schemas`, and the single
`app.module.ts` wiring line.

## Known issues

- `tenant.name` is overwritten by the company-info `legalName` even if the
  operator skips ahead — acceptable (name is also set at signup) and editable
  later in Settings.
- Activation derivation runs read queries on each `GET /progress`; fine at
  onboarding volume, revisit if it becomes a hot path.
