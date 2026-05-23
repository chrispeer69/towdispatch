# CONFLICT REPORT — PR #89 rebase aborted (structural collision)

**Date:** 2026-05-23
**Branch:** `feature/tier-offer-composer-session-2`
**Attempted:** `git rebase origin/master`
**Outcome:** Aborted. The conflict is **structural, not textual** — do not guess-merge.

---

## TL;DR

Master already contains a **complete, more-advanced, independently-built Tier
Offer Composer module** that was merged while PR #89 was open. PR #89 is a
**parallel implementation of the exact same feature** with different file
names, different service decomposition, a different cron model, and a
different magic-link approach. Rebasing #89 onto master would create a second
`TierOffersModule`, duplicate/overlapping controllers and routes, and a
clashing `ConfigService` getter. There is no "keep Session 2 logic, apply
master formatting on top" path — the two are not formatting variants of one
codebase, they are two codebases for one module.

**Recommendation: close PR #89 as superseded.** Salvage value (if any) is
called out at the bottom.

---

## What landed on master (the winning implementation)

Two commits on `origin/master` under `apps/api/src/modules/tier-offers/`:

| Commit | Subject |
|---|---|
| `9b924ed` | `feat(tier-offer-composer): API services + email + public landing page (Session 2)` |
| `db71c26` | `feat(tier-offer-composer): SendGrid webhook + auto-expiry cron (Session 4)` |

Master's module is 17 files:

```
lifecycle-cron.service.ts (+ .spec)        magic-link.ts (+ .spec)
sendgrid-webhook-signature.ts (+ .spec)    sendgrid-webhook.controller.ts
sendgrid-webhook.service.ts (+ .spec)      tier-offer-enforcement.service.ts (+ .spec)
tier-offer-reports.service.ts (+ .spec)    tier-offer.service.ts
tier-offers-public.controller.ts           tier-offers.controller.ts
tier-offers.module.ts
```

Key architectural facts about master's version:
- Single `TierOfferService` (not split into composer + recipient).
- `magic-link.ts` for token signing (not a `TierOfferTokenService` class).
- `TierOfferLifecycleCron` — a **5-minute** lifecycle tick that expires
  non-responders AND walks offer status `sent → event_active →
  event_concluded`.
- Adds `TierOfferEnforcementService` (consumed by `JobsModule`) and
  `TierOfferReportsService` — neither exists in PR #89.
- Adds a full SendGrid webhook surface (signature verification + handler).
- `ConfigService.get tierOffer()` returns `{ cronEnabled, webhookPublicKey }`
  and a new env `SENDGRID_WEBHOOK_PUBLIC_KEY`.

## What PR #89 contains (the superseded implementation)

7 source files + 2 specs, different names and decomposition:

```
tier-offer.repository.ts            tier-offer-token.service.ts (+ .spec)
tier-offer-composer.service.ts      tier-offer-recipient.service.ts
tier-offer-expiry-sweep.cron.ts     tier-offer-admin.controller.ts
tier-offer-public.controller.ts     tier-offer-state.ts (+ .spec)
tier-offers.dtos.ts                 tier-offer-mappers.ts
```

Key architectural facts about PR #89's version:
- Split into `TierOfferComposerService` + `TierOfferRecipientService` +
  `TierOfferRepository` (repo-per-module pattern).
- `TierOfferTokenService` class for HMAC tokens (format
  `v1.<recipientId>.<expiryMs>.<nonce>.<sig>`).
- `TierOfferExpirySweepCron` — a **nightly 02:30** sweep that only expires
  stale recipients (does NOT walk offer status).
- No enforcement service, no reports service, no SendGrid webhook.
- `ConfigService.get tierOffers()` (plural) returns
  `{ cronEnabled, magicLinkSecret, magicLinkTtlDays }` and new envs
  `TIER_OFFER_MAGIC_LINK_SECRET`, `TIER_OFFER_MAGIC_LINK_TTL_DAYS`.

## The conflicts, file by file

| File | Conflict type | Why structural |
|---|---|---|
| `apps/api/src/modules/tier-offers/tier-offers.module.ts` | **add/add** | Both branches define `TierOffersModule` with disjoint provider/controller sets. Cannot coexist; cannot textually merge — the resulting module would register two parallel DI graphs and two public controllers for the same domain. |
| `apps/api/src/config/config.schema.ts` | content | Both add `TIER_OFFER_CRON_ENABLED`. Master adds `SENDGRID_WEBHOOK_PUBLIC_KEY`; #89 adds `TIER_OFFER_MAGIC_LINK_SECRET` + `_TTL_DAYS`. The cron flag now means two different things (5-min lifecycle vs nightly sweep). |
| `apps/api/src/config/config.service.ts` | content | Master adds `get tierOffer()` → `{cronEnabled, webhookPublicKey}`; #89 adds `get tierOffers()` → `{cronEnabled, magicLinkSecret, magicLinkTtlDays}`. Near-identical accessor names, incompatible shapes. |
| `apps/api/src/app.module.ts` | auto-merged | Both import `TierOffersModule` from the same path — git auto-resolved, but the import now resolves to whichever module file wins, which is itself the unresolved add/add above. |
| Entire module bodies | n/a | The 7 PR-#89 source files and master's 17 files are different filenames, so git sees them as independent adds — no textual conflict, but importing both yields duplicate route registration and a non-compiling `TierOffersModule`. |

**Conflict count at rebase stop:** 3 files flagged by git (`config.schema.ts`,
`config.service.ts`, `tier-offers.module.ts`). The true blast radius is the
whole module — git's 3-file count understates it because the two
implementations use different filenames.

## Why I did not guess-merge

The task rule: *"If conflict is structural (schema collision, AppModule wiring
rewrite), abort and write CONFLICT_REPORT.md — do not guess."* This is the
textbook case:

1. There is no common ancestor for the module bodies — they were written
   independently. A merge isn't reconciling edits, it's choosing one design.
2. Keeping both compiles to a broken state (duplicate `@Module`, duplicate
   public controllers on overlapping routes, two cron schedulers for the same
   rows).
3. Keeping #89 over master throws away the merged Session 2+4 work (email,
   webhook, enforcement service that `JobsModule` now depends on) — a
   regression, not a rebase.
4. Master's version is strictly a superset (it has everything #89 has plus
   email + webhook + enforcement + reports), so #89 carries no unique
   capability that master lacks.

## Recommendation

**Close PR #89 as superseded by `9b924ed` + `db71c26`.** The feature it
delivers already shipped to master via a different implementation that is
further along (Session 4 vs this branch's Session 2 scope).

### Possible salvage (optional, low priority)

If a reviewer wants to harvest anything from #89 before closing, the only
candidates that aren't already on master in equivalent form:

- `tier-offer-state.ts` — the pure offer/recipient transition table is a
  clean, well-tested unit (17 passing cases in `*.spec.ts`). Master walks
  status inside `TierOfferLifecycleCron` without an extracted pure machine;
  if the team wants that testability, the state table could be lifted over as
  a refactor. **Not a blocker — master works without it.**

Everything else in #89 (repository, token service, composer/recipient
services, controllers, cron) has a direct, more-complete counterpart on
master.

## State of the branch

Rebase aborted cleanly. `feature/tier-offer-composer-session-2` is untouched
at its pre-rebase tip:

```
c6d6a56 test(api): Tier Offer Composer (Session 2) — service-layer unit tests + harness
058b0a2 feat(api): Tier Offer Composer (Session 2) — service + cron + admin/public layer
d7c4a86 chore(shared): relax read DTO recipientEmail to z.string()   ← Session 1 base
```

No force-push performed (nothing to push — the rebase produced no valid
result). This report is the only addition.
