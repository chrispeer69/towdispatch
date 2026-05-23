# Tier Offer Composer — Session 2 Report

**Date:** 2026-05-23
**Branch:** `feature/tier-offer-composer-session-2`
**Base:** `feature/tier-offer-composer-session-1`
**Status:** Shipped — service + cron + admin/public layer on Session 1's schema. Build + lint clean, 52 new unit tests passing, full API suite green (232 passed / 376 DB-gated skipped). PR opened, not merged.

---

## TL;DR

Session 1 shipped the **schema** for Moat #3: a motor-club **tier-offer
negotiation composer** — an operator turns a `dynamic_pricing_tier` into a
signed, magic-linked offer sent to account managers who accept/decline
independently. Session 2 builds the runtime on top of that schema:
repository, token service, offer-lifecycle service, recipient/ledger
service (operator + public-token surfaces), nightly expiry-sweep cron, and
the admin + public REST controllers.

> **Scope correction (see SESSION_2_DECISIONS.md §1):** the task prompt
> described a *plan-upgrade-trigger evaluator* (3rd truck, 250 jobs/month,
> utilization thresholds). That feature is **unbuildable on Session 1's
> schema** — no column can store any such trigger. Per CLAUDE.md Rule 9
> (mirror the contract), I built what Session 1's schema + commit message
> actually define: the magic-link tier-offer composer. This is the single
> highest-stakes call of the session; the full rationale is in the decisions
> doc.

---

## Block-by-block status

| Block | Status | Notes |
|---|---|---|
| `TierOfferRepository` (RLS-scoped CRUD) | ✅ | Takes a tenant-scoped `Tx`; never opens its own connection. |
| `TierOfferTokenService` (HMAC magic-link) | ✅ | `v1.<id>.<expiry>.<nonce>.<sig>`, constant-time verify, stored verbatim against the global unique index. |
| `TierOfferComposerService` (offer lifecycle) | ✅ | compose / updateDraft / send / markEventActive / conclude / cancel / softDelete, state-machine validated. |
| `TierOfferRecipientService` (roster + accept/decline) | ✅ | Operator surface (add/update/revoke/mark-response) + public token surface (view/accept/decline). |
| `TierOfferExpirySweepCron` (nightly) | ✅ | `30 2 * * *`, gated by `TIER_OFFER_CRON_ENABLED` (default false), idempotent. |
| `TierOfferAdminController` (`@Roles` OWNER/ADMIN/…) | ✅ | RFC 9457 problem+json via global filter; OWNER/ADMIN writes, MANAGER operational, all-authenticated reads. |
| `TierOfferPublicController` (`@Public`, token) | ✅ | `/public/tier-offers/:token` + `/accept` + `/decline`. |
| Audit on state transitions | ✅ | Via the DB `fn_audit_log()` trigger (Session 1) — every write runs inside a tenant-scoped tx with `app.current_user_id` set. |
| Unit tests | ✅ | 52 passing: token (7), state machine (10), composer (16), recipient (14), cron (5). |
| Lint / build / full test | ✅ | biome clean; `tsc` clean; 232 passed / 376 skipped. |
| accept/decline as **admin** endpoints | 🟡 deviation | Moved to the public token surface — they are recipient actions, not operator actions (decisions doc §2). Operator phone-call path = `POST /recipients/:id/mark-response`. |
| Email send / SendGrid webhook | 🟡 deferred | Session 3 — `send` flips recipients to `sent` (link live) without emailing yet. |
| Composer UI / public landing page | 🟡 deferred | Session 4 (web). |
| New Zod payloads in `packages/shared` | 🟡 deferred | Kept module-local (`tier-offers.dtos.ts`) to honor the "don't touch files outside the module" constraint; promote in a later session. |

---

## What shipped (✅)

- **15 source files** under `apps/api/src/modules/tier-offers/` (module,
  repository, token service, 2 services, cron, 2 controllers, mappers, state
  machine, DTOs, decisions doc) + this report.
- **Env:** `TIER_OFFER_CRON_ENABLED` (default false),
  `TIER_OFFER_MAGIC_LINK_SECRET` (32+ chars), `TIER_OFFER_MAGIC_LINK_TTL_DAYS`
  (default 14) in `config.schema.ts`, plus a `tierOffers` accessor on
  `ConfigService`.
- **Wiring:** `TierOffersModule` registered in `AppModule`.
- **Tests:** 5 spec files, 52 tests, all passing (2 co-located pure specs in
  `src/`, 3 fake-backed specs + a fakes harness in `test/tier-offers/`).

## What was NOT touched

- No schema changes (Session 1's job).
- No files outside `apps/api/src/modules/tier-offers/` except `app.module.ts`
  (wiring) + `config.schema.ts` / `config.service.ts` (env).
- `TIER_OFFER_CRON_ENABLED` stays **false** — Chris flips it in Railway when
  motor-club offers go live.

---

## Test coverage

| Suite | Tests | What it proves |
|---|---|---|
| `tier-offer-token.service.spec.ts` | 7 | mint/verify round-trip, TTL-past-deadline, expiry rejection, wrong-secret forgery, malformed input, flipped-sig, nonce uniqueness. |
| `tier-offer-state.spec.ts` | 10 | every legal/illegal offer transition, terminal states, recipient respondable/terminal/revocable predicates. |
| `tier-offer-composer.service.spec.ts` | 16 | compose (tier validation, inline roster), draft-only edit guard, send (requires recipients, flips pending, illegal-transition guard), activate/conclude, cancel-revokes-in-flight, soft-delete guards. |
| `tier-offer-recipient.service.spec.ts` | 14 | add/revoke/mark-response guards + public token path (view, accept, decline, idempotency, conflicting-answer, expired, forged-token 403). |
| `tier-offer-expiry-sweep.cron.spec.ts` | 5 | env-gate no-op, sweep targets only in-flight-past-TTL, idempotency, delivered/opened coverage. |

RLS / tenant-isolation is **not** unit-tested — it's a Postgres-level
guarantee covered by Session 1's gated real-DB integration spec
`apps/api/test/tier-offer-composer-rls.spec.ts`.

---

## Known issues / follow-ups

- **Session 3:** real SendGrid dispatch + delivery/open webhook → flips
  recipients sent→delivered→opened and stamps `email_*_at`.
- **Session 4:** operator composer UI + public magic-link landing page (web);
  promote `tier-offers.dtos.ts` payloads to `packages/shared` then.
- **Token rotation:** single `TIER_OFFER_MAGIC_LINK_SECRET` only; rotation
  infra (key id in token, multi-key verify) is a later hardening pass.
- **Repo note:** during this session another process (an auto-commit
  hook/agent) committed the module to the branch as `058b0a2` while work was
  in flight; the final test-harness fix + 3 service specs were committed on
  top. No conflicts; final tree verified green.

---

## Commands

```bash
# from the worktree / repo root
pnpm install
pnpm --filter @ustowdispatch/api build
pnpm --filter @ustowdispatch/api test          # 232 passed / 376 skipped
npx biome check apps/api/src/modules/tier-offers apps/api/test/tier-offers

# run just the new specs
cd apps/api && npx vitest run src/modules/tier-offers test/tier-offers   # 52 passed
```

## Manual smoke checklist (once a tenant + tier exist)

1. `POST /tier-offers` (OWNER) → draft offer off a live `tierId`.
2. `POST /tier-offers/:id/recipients` → adds a recipient, mints a token.
3. `POST /tier-offers/:id/send` → offer `sent`, recipient `sent`.
4. `GET /public/tier-offers/:token` → renders the offer (no auth).
5. `POST /public/tier-offers/:token/accept` → recipient `accepted`,
   idempotent on repeat.
6. `POST /tier-offers/:id/cancel` → offer `cancelled`, in-flight recipients
   `revoked`.
7. Set `TIER_OFFER_CRON_ENABLED=true`, drive `runForAllTenants()` → expires
   in-flight recipients past their TTL.
