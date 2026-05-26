# Session 33 — Auction & Remarketing Marketplace

## TL;DR

Built a complete per-tenant internal remarketing marketplace: vehicles cleared through
lien processing are listed for competitive bidding, a separately-authenticated pool of
bidders places bids, and listings auto-award the highest bid ≥ reserve at close.
Backend (migration + RLS + service + bidder-auth + lifecycle cron + email), shared Zod
contracts, staff web UI, and a public bidder marketplace web UI all ship. Typecheck,
biome, and the full API unit suite are green; the Next build succeeds. DB-backed specs
(RLS + integration) are authored and run under CI / with a DB — they skip locally
because docker is unavailable in this environment.

Branch: `feature/session-33-auction-marketplace` (off `origin/master`).

---

## Decision log

1. **Worktree.** The launch block expected `/tmp/claude-worktrees/auction-marketplace`,
   which did not exist — this session started in the `lien-processing` worktree on
   `feature/session-23-lien-processing`. Conservative call: created a dedicated worktree
   `/tmp/claude-worktrees/auction-marketplace` on a fresh branch off `origin/master`
   (which carries the merged impound module #97), rather than contaminate the S23 lien
   branch. Matches the established one-worktree-per-session pattern.

2. **Migration number `0038`.** Per the spec, coordinated with the parallel S23 lien
   session's `0037`. `origin/master` already carries duplicate `0034_*` and `0036_*`
   files, so `check-migrations.sh` (strict `prev+1`) cannot be passing in CI today; the
   runtime migrator (`packages/db/src/migrate.ts`) globs + sorts `.sql`, so `0038`
   applies regardless of the gap.

3. **Listing eligibility gate.** The spec's `impound_records.status='ready-for-sale'`
   and `has_clear_lien` columns, and `lien_cases.status='completed'`, do **not** exist on
   this branch (S23 lien is unmerged; impound only has `lien_eligible`). Gated instead on
   `impound_records.lien_eligible = true AND status NOT IN (released/transferred/disposed)
   AND not already on an active listing`. `auction_listings.lien_case_id` is reserved as a
   plain `uuid` (no FK — target table absent) so S23 can backfill + add the FK later. When
   S23 merges, tighten the gate to `lien_cases.status='completed'`.

4. **Bidder auth — separate JWT.** Chose a fully separate keyspace (audience `…-bidder`,
   `JWT_BIDDER_SECRET` derived from `JWT_SECRET` via `::bidder`, argon2id password hash
   reused from `PasswordService`) mirroring the existing driver-auth pattern, rather than
   reuse a customer-portal session — S32 white-label / customer portal is **not merged**
   on this branch, so there was nothing to reuse. Bidders are per-tenant (v1). Bidder DB
   operations run on the **admin pool with an explicit `tenant_id` filter** because an
   unauthenticated public surface has no tenant context (the "login lookup-by-slug" seam).
   The email-verification token lives on the `auction_bidders` row (rotated on consume) —
   no separate table.

5. **Anti-snipe.** A bid placed within the final **60s** of a listing's window pushes
   `list_ends_at` out by **5 minutes** (pure logic in `auction-bid.logic.ts`, persisted in
   the same locked transaction as the bid).

6. **Reserve handling.** At close, the highest bid ≥ reserve (or any bid when reserve is
   null) → `sold` + auto-award (`winning_bid_id`, `is_winning`). No qualifying bid →
   `ended` (manual review) and staff are notified; the `POST /auction/listings/:id/award`
   endpoint lets staff award a specific bid from the `ended` state.

7. **Marketplace location — route in `apps/web`, not a new app.** S32 did not create an
   `apps/marketplace`, so the bidder UI lives at the top-level public segment
   `apps/web/src/app/marketplace/[tenantSlug]/…` (sibling to the existing public `offers`
   / `track` / `pay` segments; no `(app)` staff shell, no `requireUser`). Bidder data flows
   through a same-origin forwarding BFF (`/api/auctionpub/[...path]`) that passes the
   bidder bearer token through to the API — avoids CORS and keeps the token off
   cross-origin requests.

8. **Bid concurrency.** `placeBid` and `closeLiveListing` take `SELECT … FOR UPDATE` on the
   listing row before reading the current high and inserting, so two bidders racing at the
   top cannot both win. The unique index `(listing_id, bidder_id, bid_amount_cents)` is the
   idempotency backstop for a double-submit, not the primary guard.

9. **i18n — English only (deliberate Rule-9 over Rule-4).** The repo ships **zero** i18n
   infrastructure (no next-intl, no message catalog). Per Rule 9 (mirror existing) the UI
   follows the impound module's label-constant pattern (`STATUS_LABEL`, etc.) so a future
   i18n pass can wrap them in a `t()` lookup without touching call sites — rather than
   invent a parallel es/en system with no infra to mirror into. Noted as a conscious
   deviation from Rule 4 (Spanish parity).

10. **Shared contracts path.** `packages/shared/src/schemas/auction.ts` (not the spec's
    `src/auction/`) — the package's `exports` map only exposes `./schemas`; a top-level
    `src/auction/` folder would not be importable as `@ustowdispatch/shared`.

11. **`winning_bid_id` FK.** Added via `ALTER TABLE … ADD CONSTRAINT` after `auction_bids`
    exists (forward reference). Not declared in the Drizzle schema (would create a circular
    import between `auction-listings.ts` and `auction-bids.ts`); the DB holds the FK.

---

## What shipped ✅

- **DB** — `0038_auction_marketplace.sql`: `auction_bidders`, `auction_listings`,
  `auction_bids`, `auction_listing_photos`. FORCE-RLS + tenant-isolation policy, audit
  triggers, shared `updated_at` trigger, cross-tenant consistency triggers on every FK
  table, bid idempotency unique index, forward-ref `winning_bid_id` FK, rollback
  annotation. Drizzle schemas + barrel export.
- **Shared** — `packages/shared/src/schemas/auction.ts` (DTOs, public DTO, staff +
  bidder payloads) + 5 new error codes.
- **API** — `apps/api/src/modules/auction/`: `AuctionService` (inline Drizzle, FOR-UPDATE
  bid path, anti-snipe, close/award, public reads via admin+explicit-tenant),
  `AuctionController` (staff), `MarketplaceController` (public browse + bidder bid +
  my-bids), `bidder-auth/` (service + controller + `BidderJwtGuard`), env-gated
  `AuctionLifecycleCron`, pure `auction-bid.logic.ts`. Wired into `app.module.ts`,
  `config.schema.ts`, `config.service.ts`, `JwtService`.
- **Email** — 5 template pairs (bidder verification, bid-placed, outbid, result,
  staff-notification) + `EmailService` methods. Notification deep-links resolve the tenant
  slug so they land on the right marketplace.
- **Web staff** — `(app)/auction` list (with status-count summary) / `new` (lists
  eligible vehicles itself) / `[id]` detail (publish / withdraw / end / award + bid
  history + photos), BFF proxy, typed client, UI helpers.
- **Web bidder** — public `marketplace/[tenantSlug]` browse / listing+bid / register /
  login / verify / my-bids, forwarding BFF, browser client with localStorage session.
- **Tests** — `auction-bid.logic.spec.ts` (18 unit tests, **passing**), `auction-rls.spec.ts`
  (cross-tenant isolation), `integration/auction.spec.ts` (lifecycle + below-high reject +
  after-end reject + anti-snipe extension + reserve-not-met → manual award).
- **Env** — `AUCTION_LIFECYCLE_CRON_ENABLED` (default false), `JWT_BIDDER_SECRET`
  (optional), `JWT_BIDDER_TTL` (default 24h).

## Deferred 🟡

- **DB-backed specs run locally** — docker is unavailable in this environment, so
  `auction-rls.spec.ts` and `integration/auction.spec.ts` skip locally (the repo norm —
  only e2e runs in CI). They are authored, compile, and run against a DB.
- **Photo uploader UI** — listings accept already-uploaded S3 photo keys (textarea); a
  drag-drop uploader is out of scope.
- **Revenue report** — the staff list shows status counts; a revenue roll-up needs the
  per-listing winning amount (not in the list DTO) and is deferred.
- **Sidebar nav entry** — not added; impound itself is URL-only in the sidebar, so this
  mirrors that precedent (reach via `/auction`).
- **Bidder refresh tokens** — 24h access token only; no rotation in v1.
- **Buyer payment escrow** and **cross-tenant public marketplace** — explicitly out of
  scope per the brief.

## NOT touched

- Impound module (read-only: eligibility query + vehicle snapshot only).
- Lien module (not present on this branch).
- Staff/operator auth.

## Test coverage

- Unit (run, green): bid validation (below-start, at/below-high, one-cent-above),
  not-live / before-open / after-close rejection, anti-snipe window math, reserve
  auto-award vs manual-review outcome — 18 assertions.
- RLS (DB): listings/bids/bidders cross-tenant read, cross-tenant UPDATE no-op, foreign
  `tenant_id` INSERT rejected by `WITH CHECK`.
- Integration (DB): create → publish → register/verify 3 bidders → bids (incl. reject
  below high) → end → auto-award + winner flagged; anti-snipe extension; reserve-not-met
  → manual award.

## Commands

```
pnpm --filter @ustowdispatch/shared build && pnpm --filter @ustowdispatch/db build
pnpm --filter @ustowdispatch/api typecheck   # clean
pnpm --filter @ustowdispatch/web typecheck   # clean
pnpm --filter @ustowdispatch/api test        # 321 passed, 417 skipped (no DB), 0 failed
pnpm build                                    # web + api build OK
# With a DB:
DATABASE_URL=… DATABASE_ADMIN_URL=… REDIS_URL=… pnpm db:migrate
DATABASE_URL=… DATABASE_ADMIN_URL=… REDIS_URL=… pnpm --filter @ustowdispatch/api test
```
