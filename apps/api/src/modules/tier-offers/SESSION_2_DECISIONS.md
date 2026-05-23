# Tier Offer Composer — Session 2 Decision Log

**Date:** 2026-05-23
**Branch:** `feature/tier-offer-composer-session-2`
**Base:** `feature/tier-offer-composer-session-1`

Every decision below was made in-flight without asking for clarification
(CLAUDE.md Rule 1). Each is grounded in what Session 1 actually shipped or
in an existing pattern in the repo.

---

## 1. Followed Session 1's schema, NOT the task prompt's "upgrade-trigger evaluator" — highest-stakes call

The Session 2 task prompt described a `TierOfferEvaluatorService` that
detects plan-upgrade triggers ("3rd truck added", "250 jobs/month
exceeded", "plan utilization thresholds") and composes a *plan-tier-upgrade
nudge* to the tenant.

**That feature cannot be built on Session 1's schema.** Session 1
(`packages/db/sql/0034_tier_offer_composer.sql`, commit `b1d970a`) shipped a
fundamentally different thing: a **motor-club tier-offer negotiation
composer**. Its own commit message states it "turns a dynamic_pricing_tier
into a signed, magic-linked offer sent to motor-club account managers, who
accept or decline independently" and explicitly scopes "services,
controllers, the operator-side composer UI, and the public magic-link
landing page" to **Sessions 2-4**.

Concretely, the schema has:
- `tier_offers.tier_id → dynamic_pricing_tiers(id)` — an offer IS a pricing tier
- `event_window_start / event_window_end` — the elevated-rate window
- `committed_truck_count` — trucks the operator commits for the event
- `acceptance_deadline_at` + `default_for_non_responders`
- `tier_offer_recipients` — a per-account-manager acceptance ledger with
  `magic_link_token`, delivery/open/response tracking

There is **no column anywhere** that could store a 3rd-truck threshold, a
250-jobs/month counter, or a plan-utilization percentage. The prompt's
feature and Session 1's schema share a name and nothing else.

**Decision:** per CLAUDE.md Rule 9 ("when in doubt, mirror — the schema is
the contract"), I built the service/cron/admin layer that Session 1's
schema and commit message describe: the magic-link tier-offer composer.
The prompt's evaluator description was treated as a mislabel.

---

## 2. accept / decline are PUBLIC (recipient) actions, not admin endpoints

The prompt asked for `POST /tier-offers/:id/accept` and
`POST /tier-offers/:id/decline` as **admin** endpoints with `@Roles [OWNER,
ADMIN]`.

But in Session 1's model, **accept/decline are recipient actions** — a
motor-club account manager clicks a magic link and responds. The acceptance
ledger (`tier_offer_recipients`) tracks per-recipient response, IP, and user
agent. An operator does not "accept an offer"; a recipient does.

**Decision (visible deviation from the prompt — naming it explicitly):**
- Recipient accept/decline live on the **public token surface**:
  `POST /public/tier-offers/:token/accept` and `.../decline` (`@Public`,
  no auth, token-resolved).
- The operator path for logging a phone-call response is
  `POST /tier-offers/recipients/:recipientId/mark-response` (`@Roles
  [OWNER, ADMIN, MANAGER]`) — this is the "markResponseFromManualPhoneCall"
  surface that Session 1's schema comments anticipated.

This matches the contract; building an admin accept/decline would
contradict the ledger model.

---

## 3. New Zod payloads kept inside the module, not promoted to packages/shared

Session 1's `tier-offer-recipient.ts` comment says "the recipient-facing
accept/decline submission has its own narrower payload (added in Session
2)." But the Session 2 constraint forbids touching files outside
`apps/api/src/modules/tier-offers/` except AppModule wiring + config.

**Decision:** the four new payload schemas (`cancelTierOfferSchema`,
`markRecipientResponseSchema`, `publicAcceptTierOfferSchema`,
`publicDeclineTierOfferSchema`) and the public-view interfaces live in
`tier-offers.dtos.ts` inside the module. A later session can promote them to
`packages/shared` when the web/landing client needs to import them, without
breaking anyone today. The operator-facing create/update payloads continue
to come from `@ustowdispatch/shared` (Session 1).

---

## 4. Magic-link token = HMAC-SHA-256, self-describing, stored verbatim

Token format: `v1.<b64url(recipientId)>.<expiryMs>.<nonce>.<sig>`.

- The recipient id is embedded so the public route resolves the row with
  **no tenant context** (the global unique index on `magic_link_token` and
  the admin-pool lookup make this safe — mirrors `PaymentsService`).
- The stored token is compared byte-for-byte after signature verify
  (defense in depth: a forged token carrying a real id still fails the
  column match).
- A 12-byte random nonce guarantees no same-millisecond collision on the
  global unique index and makes the token unguessable from id+expiry.
- Signature compared in constant time (`timingSafeEqual`).
- Secret + TTL come from new env (`TIER_OFFER_MAGIC_LINK_SECRET`,
  `TIER_OFFER_MAGIC_LINK_TTL_DAYS`, default 14). No rotation infra in S2 —
  single key, documented.

The link stays valid `TTL_DAYS` **past** `acceptance_deadline_at` so a late
click lands on a friendly "no longer accepting" page rather than a 404 —
exactly what Session 1's schema comment described.

---

## 5. Offer + recipient state machines, validated by a pure module

`tier-offer-state.ts` holds the transition tables as pure functions (mirrors
`job-state-machine.ts` / `dynamic-pricing-helpers.ts`), so the rules are
unit-testable without a DB.

- Offer: `draft → sent → event_active → event_concluded`; cancel reachable
  from any live state. Terminal: `event_concluded`, `cancelled`.
- Recipient: `pending_send → sent → (delivered → opened) →
  accepted|declined|expired|revoked`. `bounced` terminal (S3 delivery).
- `updateDraft` only allowed in `draft` (status transitions go through
  dedicated actions, never a blind PATCH — matches Session 1's deliberate
  omission of `status` from the update schema).
- Soft-delete blocked on a live/sent offer — a sent offer is a contractual
  record and must be **cancelled** (which revokes in-flight recipients),
  not deleted.

---

## 6. `send` flips recipients to `sent` without emailing (email is Session 3)

`POST /tier-offers/:id/send` (`draft → sent`) requires ≥1 recipient and
flips each `pending_send` recipient to `sent`. No SendGrid call happens —
real dispatch + `email_sent_at` stamping + the delivery/open webhook land in
Session 3. Here `sent` means "offer dispatched, link live, awaiting
response," which is what the expiry sweep and the public accept path key on.
Documented so a reviewer doesn't expect an email to fire.

---

## 7. Cron does the expiry sweep only; nightly at 02:30

The prompt's "TierOfferCronJob" maps to Session 1's documented cron target:
the partial index `tier_offer_recipients_tenant_expiry_active_idx` exists
precisely "to auto-expire after their magic-link TTL elapses."

`TierOfferExpirySweepCron` runs nightly at `30 2 * * *` (off-peak, clear of
the dynamic-pricing crons at :00/:03/:05), gated by `TIER_OFFER_CRON_ENABLED`
(default false — stays off in Railway until Chris flips it). Idempotent: it
only touches `sent|delivered|opened` rows whose link has expired; a second
run is a no-op. Per-tenant iteration via the admin pool, same shape as
`AutoRevertService` / `DemandSurgeService`.

---

## 8. Audit via the DB trigger, not an app-layer AuditLogService

ARCHITECTURE.md invariant #2 + Session 1's migration install
`fn_audit_log()` as an AFTER INSERT/UPDATE/DELETE trigger on both tables.
Every state change runs inside a single `runInTenantContext` transaction
with `app.current_user_id` set, so the trigger captures actor + before/after
automatically. No separate `AuditLogService` call is needed (and there is no
such app-layer service in this codebase — audit is purely trigger-driven).

---

## 9. Repository takes a tenant-scoped `Tx`, never opens its own connection

`TierOfferRepository` methods all accept a `Tx` handle obtained from
`TenantAwareDb.runInTenantContext()`. RLS is therefore a structural
guarantee, not a per-query discipline. The public path uses
`TransactionRunner.runAsAdmin()` only to resolve token → tenant (RLS would
hide the row pre-context), then immediately re-enters tenant scope — the
exact pattern `PaymentsService.publicView` uses.

---

## What was NOT touched

- No schema changes (Session 1's job).
- No files outside `apps/api/src/modules/tier-offers/` except: AppModule
  wiring (`app.module.ts`) and env (`config.schema.ts` + `config.service.ts`
  accessor).
- No email send / SendGrid webhook (Session 3).
- No operator composer UI / public landing page (Session 4, web).
