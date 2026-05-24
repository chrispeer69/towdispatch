# SESSION 25 — Self-Serve Onboarding — Decision Log

Branch: `feature/session-25-self-serve-onboarding` · Base: `origin/master`

Operating rule honored: no questions asked. Every ambiguity was resolved by
mirroring existing patterns, favoring the safer/more-reversible option, and
shipping working code. Calls recorded below.

---

## D1 — Compose on top of auth; never duplicate signup/verify

**Found:** `AuthService.signup` already provisions tenant + owner + email-
verification token AND sends the verification email; `/auth/verify-email`,
`/auth/check-slug`, `/auth/resend-verification` already exist, and the web app
already has `/verify-email` + `/verify-email-pending` routes.

**Decision:** Onboarding does **not** re-implement signup or verification.
`POST /onboarding/start` (public) runs captcha + IP rate-limit, then delegates
to the injected `AuthService.signup` (AuthModule exports it), and afterward
creates the `onboarding_progress` row + emits `account_created` /
`free_tier_activated`. The existing auth module was **not modified**.

## D2 — "First job dispatched" is derived, not hooked

**Decision:** Modifying jobs/dispatch is out of scope. `ActivationService`
reads the tenant's dispatched-job count (status ∈ dispatched/enroute/on_scene/
in_progress/completed) on every `GET /onboarding/progress` and lazily emits
`first_job_dispatched` once. Same lazy-derive pattern for `email_verified`,
`first_truck_added`, `first_driver_added`, `first_user_invited` — read real
state, never trust the client. The `(tenant_id, event_type)` unique index makes
emission idempotent at the DB level.

## D3 — Free-tier config is module-local + env-overridable

**Found:** No subscription/plan-limit config exists (`dynamic-pricing-tiers` is
service pricing; `tier-offers` is the Moat #3 discount engine).

**Decision:** `onboarding.config.ts` holds the free-tier caps (default **2
trucks / 2 drivers**, the "1–2 trucks" scope guidance), overridable via
`ONBOARDING_FREE_TIER_MAX_TRUCKS` / `..._MAX_DRIVERS`. Not threaded through the
global `ConfigService` (outside this session's file scope). Truck-cap enforced
in `submitFirstTruck`; driver-cap in `submitFirstDriver`.

## D4 — Company-info step avoids the Company-Profile first-save gate

**Found:** `TenantsService.updateCurrent` enforces the **full** 17-field
`companyProfileSettingsSchema` on first save (when `settings` has no
`physical_address`). Requiring all 17 fields would break a "< 2 minute" wizard.

**Decision:** The company-info step updates only `tenant.name` (via
`TenantsService.updateCurrent({ name })` — no `settings`, so no validation
fires) and persists the full collected payload in
`onboarding_progress.step_data.companyInfo`. The structured Company Profile
remains the single source of truth, completed later in Admin Settings. No
direct settings write → no interaction with the existing Company-Profile flow.

## D5 — English UI with `// TODO(i18n)`; no `(public)` route group

**Found:** the web app has **no** i18n framework (no next-intl/i18next); signup
and login are English-only.

**Decision:** The wizard ships English strings matching the existing forms,
with `// TODO(i18n)` markers for the future Spanish pass (Rule 9 — mirror
existing; adding i18n infra is a separate effort). The `(public)` route group
was **not** created — `/signup` already serves as the public landing + wizard,
and an empty route group with its own layout risks conflicting with existing
root routes (advisor-confirmed).

## D6 — Necessary additive-file deviations from the literal path list

The scope's file list named `packages/db/migrations/`; the real layout differs,
and cross-tier work needs additive files. All are **new files** (or barrel
appends), never edits to unrelated module logic:

- `packages/db/sql/0036_onboarding.sql` — the literal `migrations/` dir doesn't
  exist; raw SQL migrations live in `sql/`.
- `packages/db/src/schema/{onboarding-progress,tenant-activation-events}.ts`
  (+ `schema/index.ts` append) — Drizzle typed access for the new tables.
- `packages/shared/src/schemas/onboarding.ts` (+ `schemas/index.ts` append) —
  cross-tier Zod validation (client wizard + server `ZodBody`).
- `apps/web/src/app/api/onboarding/start/route.ts` +
  `apps/web/src/app/api/onboarding/[...path]/route.ts` — BFF proxies. There is
  no global catch-all proxy; each module has its own (`api/fleet/[...path]`,
  `api/auth/signup`). Without these the wizard cannot reach the onboarding API
  without leaking the access token to the browser. Reusing the fleet/users
  proxies would bypass onboarding step-tracking **and** the free-tier cap, so a
  dedicated proxy is the correct production choice.
- `SESSION_25_*.md` at repo root — mandated by Rule 6 + the task.

`app.module.ts` is the only pre-existing app file edited (allowed: module
wiring). The auth module and all other modules are untouched.

## D7 — Activation milestones recorded via idempotent ledger

`tenant_activation_events` is append-only with a `(tenant_id, event_type)`
unique index; `ActivationService.emit` uses `onConflictDoNothing`. No soft
delete (a reached milestone is permanent). `onboarding_progress` is soft-delete
shaped with one live row per tenant (partial unique on `tenant_id`).

---

## Pre-existing issues NOT introduced by this branch (🟡 documented)

Verified untouched by this branch (`git status` shows no edits to these files):

- `pnpm lint` reports **38 errors in 8 unrelated files** (`apps/api/scripts/*`,
  `modules/import/*`, `modules/users/user-invites.*`). My new/modified files are
  **biome-clean**. Fixing those files is out of scope (forbidden by the file
  constraint) and unrelated to onboarding.
- `pnpm --filter web test` has **1 pre-existing failure** in
  `src/lib/driver/__tests__/offline-queue.spec.ts` (driver api-client hostname
  resolution under the test env) — unrelated to onboarding; that file is
  untouched.

Everything this session added is type-clean, biome-clean, builds, and passes.
