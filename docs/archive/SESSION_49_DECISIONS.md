# Session 49 — Repo Workflow Module (core) — Decision Log

Branch: `feature/session-49-repo-core` · Base: `origin/master` @ 13439ba · Migration: 0051

---

## Pre-flight: master repair (REQUIRED before feature code)

`origin/master` (the PR #129 Enterprise-SSO merge) was committed in a non-compiling
state. The verification gate cannot pass on top of it, and several of the broken
files are exactly the files Session 49 must edit (config schema/service, app.module,
db schema barrel, error-codes). So repairing the base was a prerequisite, not scope
creep. Every fix below is mechanical and union-preserving — no behavior changed.

**1. Unresolved git conflict markers in 6 files** (union-resolved — kept BOTH sides,
since #129 was an additive feature merge with non-overlapping additions):
- `apps/api/src/app.module.ts` — kept HEAD module list (PublicApi…MarketplaceApi) + `SsoModule`.
- `apps/api/src/config/config.schema.ts` — kept all HEAD env vars + the 3 SSO vars.
- `apps/api/src/config/config.service.ts` — closed the truncated `marketplaceWebhookDeliveryEnabled` getter, kept it + the `enterpriseSso` getter.
- `packages/db/src/schema/index.ts` — kept HEAD exports (…notifications) + the 5 SSO table exports.
- `packages/shared/src/constants/error-codes.ts` — kept HEAD marketplace codes + the SSO/SCIM codes.
- `apps/web/src/app/(app)/settings/tabs.ts` — split the conflicted single object into two tabs (`branding` + `sso`).

**2. Three stripped validator bodies in `config.schema.ts`** — `AUCTION_LIFECYCLE_CRON_ENABLED`,
`FRAUD_SCORE_CRON_ENABLED`, `DAMAGE_ANALYSIS_WORKER_ENABLED` had been left as bare `: z`
with no body. Restored each to the project's canonical boolean-gate pattern
(`z.enum(['true','false']).default('false').transform((v) => v === 'true')`) — confirmed
by the 20+ identical gates in the same file and the "Default false so dev/CI…" comments.

**3. Two orphaned JSDoc comments in `config.schema.ts`** (JWT_BIDDER, JWT_DEVELOPER) — each
missing its opening `/**`. Reconstructed.

**4. Two duplicate-export collisions in `packages/shared` (TS2308)** — two parallel sessions
used the same export name. Renamed the later/feature-specific side and its consumers
(shapes differ, so a single barrel winner would mis-type the other side's consumers):
- `recordOutcomeSchema`/`RecordOutcomePayload` (ai-dispatch S41 vs fraud-detection S43) →
  fraud side renamed to `recordFraudOutcomeSchema`/`RecordFraudOutcomePayload`
  (consumers: fraud-detection controller+service, web fraud-client).
- `WebhookDeliveryDto` (notifications S15 vs public-api S29) → public-api side renamed to
  `PublicApiWebhookDeliveryDto` (consumers: public-api webhooks.service, web public-api-client).

**5. Eight files mangled by "two file-versions concatenated" merges** — a code line
spliced directly into the middle of another file, truncating the first and orphaning
the second's header/imports/braces. Reconstructed each into one coherent file:
- `apps/web/src/lib/api/marketplace-client.ts` — S33 bidder client + S46 installed-apps
  client concatenated; restored `call<T>`'s body from the `req<T>` template, hoisted the
  `InstalledAppDto` import.
- `apps/web/sentry.server.config.ts` and `apps/web/sentry.edge.config.ts` — two init
  variants concatenated; kept the R-06 `SENTRY_DSN_WEB` variant (per web-hardening PR #127).
- `apps/api/src/config/config.service.ts` — FOUR mashed getters: `jwt` (return type +
  object literal had duplicate keys and two type bodies — rebuilt as the dedup'd union of
  all realms: access/refresh/mfa/driver/portal/bidder/developer secrets + TTLs), `portal`
  (missing closing brace), `backupVerify` + `publicApi` (missing closing braces).
- `apps/api/src/modules/auth/jwt.service.ts` — `PortalAccessClaims` (lost `tid` + brace) and
  `BidderAccessClaims` (lost brace) interfaces mashed; restored both + their JSDoc openers.
- `apps/web/src/components/app-shell/sidebar.tsx` — the "Lien Cases" and "DOT Compliance"
  nav items merged into one object literal (duplicate `label`/`href`/`icon`/`match`); split.

**6. DB table-const collision** — both `notifications.ts` (S15) and `webhook-deliveries.ts`
(S29) defined `export const webhookDeliveries = pgTable('webhook_deliveries', …)` (TS2308).
Renamed the notifications-side const → `notificationWebhookDeliveries` (fewer consumers: 1)
and its single consumer. NOTE: both Drizzle defs still target the same physical table
`webhook_deliveries` — a deeper data-model collision between two sessions is a KNOWN ISSUE
(see report), out of scope here; the rename is a compile-fix that preserves both runtimes.

**7. `apps/web/.../settings/api/api-settings-client.tsx`** — the public-API webhook screen
consumed the bare `WebhookDeliveryDto` (now the notifications shape post-rename) but uses
public-api fields (`.attempt`/`.maxAttempts`, status pending/delivering). Pointed it at
`PublicApiWebhookDeliveryDto` — consistent with the rename in #4.

A repo-wide scan (`* …` JSDoc body lines lacking a `/**` opener) confirmed the
comment-splice corruption was exhausted after these fixes. No behavior changed anywhere —
every fix restores the obviously-intended union/structure.

Gate state after repair (before feature code): typecheck green on shared/ui/db/e2e/web;
api iterated to green (see report for the final clean run).

---

## Feature decisions

- **Job type vs. separate workflow** — chose to add `'repo'` to the existing
  `service_type` enum (the spec's "job_type" = the real `jobs.service_type`)
  rather than a parallel job entity. State-machine reuse > duplication: a repo
  dispatch job rides `JobsService.transition` unchanged. There is NO DB CHECK on
  `service_type`, so adding the value is a TS/Zod-enum change in BOTH the db
  schema and the shared schema (they are separate enums that must stay in sync —
  the compiler enforced it via the exhaustive `Record<JobServiceType>` maps).
- **Lienholder as tenant-scoped reference (not global like jurisdictions)** —
  operators keep their own lienholder books (a bank is a different relationship
  per operator), so `lienholders` is tenant-scoped + FORCE RLS, not global ref.
- **Condition-photo slots — 8** — exterior front/rear/left/right, interior,
  odometer, damage, vin_plate (+ 'other'). Matches industry repo body-damage
  condition-report sheets. The slot is advisory (a case can carry several of one).
- **Storage-rate reuse from S22** — repo storage billing reuses the impound
  daily-rate compute (daysStored × dailyRateCents) and the existing
  `storage_daily` invoice line type; the distinguishing field is the
  line's COST CENTER (a repo invoice vs an impound release), not the math.
  Repo-specific fees got two NEW line types (`skip_trace`, `repo_attempt`);
  recovery reuses `recovery`. All flow through the existing invoices
  computeTotals path — billing is never forked (block 8).
- **Status machine** — open → located → recovered|surrendered → closed; open|
  located → cancelled. `recordRecovery` sets recovered/surrendered (by
  recovery_type) and derives `redemption_ends_at` from recovered_at +
  redemption_window_days. `releaseToLienholder`/`cancelCase` are thin aliases
  over `closeCase(disposition)`; one `/close` endpoint serves both.
- **Redemption math in UTC** — `computeRedemptionEnd` advances whole calendar
  days with setUTCDate (DST-immune, leap-day/month/year-correct). DB stores UTC;
  presentation localizes.
- **Idempotency** — partial unique on (tenant, lienholder, case_number) WHERE
  status <> 'cancelled', so a cancelled assignment frees the number for re-issue.
- **gps coords as double precision** — exposed as `number | null` in the DTO,
  no numeric-string coercion tax (adequate precision for field pins).
- **Env gate REPO_MODULE_ENABLED (default false)** — ships dark; controllers
  return 503 `repo_module_disabled` when off (mirrors VoiceDriver/MarketplaceApi).
  The `'repo'` service_type + `repo_case_id` column are inert without it.
- **No event emission this session** — unlike impound (`impound.opened`), repo
  does not emit DISPATCH_EVENTS, to avoid expanding the public-API webhook
  catalog out of scope. Deferred (🟡).
- **Driver "create repo job from case" prefill** — the DB linkage (`repo_case_id`
  FK, `'repo'` service_type) and the no-signature/no-SMS driver behavior are in
  place, but the dispatcher one-click "create job from case" action (prefilling
  debtor→customer, lienholder→payer via JobsService.create) is deferred (🟡):
  it needs a JobsService.create integration that is larger than the core slice.
- **Native driver apps (iOS/Android)** — additive: the signature-capture
  shortcut is hidden for `serviceType == 'repo'` (peaceful repo needs no debtor
  signature). NOT Xcode/Gradle-verified in this session env (🟡); the fuller
  8-slot condition-photo checklist screen is spec'd for a follow-up.
